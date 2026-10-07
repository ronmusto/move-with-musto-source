const config = window.MLS_INGEST_CONFIG ?? {};

const coreFiles = [
  'agents.txt', 'idx_cc.txt', 'idx_mf.txt', 'idx_OH.txt',
  'idx_sf.txt', 'idx_VT.txt', 'offices.txt', 'optout.txt',
];
const referenceFiles = ['areas.txt', 'counties.txt', 'field_reference.txt', 'towns.txt'];
const optionalFiles = ['reference_updates.txt'];
const commercialFiles = ['idx_bu.txt', 'idx_ci.txt', 'idx_ld.txt'];
const allowedFiles = [...coreFiles, ...referenceFiles, ...optionalFiles, ...commercialFiles].sort();
const allowedSet = new Set(allowedFiles);

const failedBuildStates = new Set(['VALIDATION_FAILED', 'PUBLISH_FAILED']);
const nonRetryableBuildStatuses = new Set([
  'BUILD_TIMEOUT_CONFIGURATION_INVALID',
  'BUILD_IDENTITY_CONFIGURATION_INVALID',
]);
const buildFailurePresentation = {
  FAILED: ['Failed', 'AWS processing reported a failure before it finished.'],
  FAULT: ['Infrastructure fault', 'AWS processing encountered an infrastructure fault.'],
  STOPPED: ['Stopped', 'AWS processing was stopped before it finished.'],
  TIMED_OUT: ['Timed out', 'AWS processing reached its allowed time limit before it finished.'],
  SOURCE_ARTIFACT_UNAVAILABLE: ['Source unavailable', 'AWS could not access the approved processing source.'],
  SOURCE_ARTIFACT_MISMATCH: ['Source rejected', 'AWS rejected a processing-source identity mismatch.'],
  BUILD_TIMEOUT_CONFIGURATION_INVALID: [
    'Timeout configuration invalid',
    'AWS returned an effective timeout below the required 45-minute minimum. An administrator must repair the AWS build project before validation is tried again.',
  ],
  BUILD_IDENTITY_CONFIGURATION_INVALID: [
    'Build identity invalid',
    'AWS rejected the build because it was not running under the expected replacement project identity. An administrator must repair the AWS build project before validation is tried again.',
  ],
};

const statusPresentation = {
  UPLOAD_PENDING: ['Uploading', 'Finish uploading the selected files.'],
  UPLOADED: ['Ready to validate', 'Start validation when you are ready.'],
  VALIDATING: ['Checking files', 'This normally takes several minutes. You may leave and return later.'],
  AWAITING_REVIEW: ['Ready for review', 'Open the report and check the totals before approving.'],
  VALIDATION_FAILED: ['Needs attention', 'The existing website data was not changed. Try validation again after resolving the issue.'],
  APPROVED: ['Approved', 'Publish this reviewed update when you are ready.'],
  REJECTED: ['Not approved', 'This update will not be published.'],
  PUBLISHING: ['Publishing', 'The current website data remains available while this finishes.'],
  PUBLISH_FAILED: ['Publication needs attention', 'The previous website data is still live. You can try publishing again.'],
  PUBLISHED: ['Published', 'This update is available to the website.'],
  EXPIRED: ['Upload expired', 'Start a new upload with the latest files.'],
};

const elements = {
  setupWarning: document.querySelector('#setup-warning'),
  message: document.querySelector('#message'),
  signIn: document.querySelector('#sign-in'),
  signOut: document.querySelector('#sign-out'),
  sessionLabel: document.querySelector('#session-label'),
  signedOutPanel: document.querySelector('#signed-out-panel'),
  workspace: document.querySelector('#operator-workspace'),
  fileInput: document.querySelector('#file-input'),
  dropZone: document.querySelector('#drop-zone'),
  useCurrentReferences: document.querySelector('#use-current-references'),
  checklist: document.querySelector('#file-checklist'),
  note: document.querySelector('#upload-note'),
  upload: document.querySelector('#upload-files'),
  clear: document.querySelector('#clear-files'),
  progress: document.querySelector('#upload-progress'),
  runsList: document.querySelector('#runs-list'),
  runsEmpty: document.querySelector('#runs-empty'),
  refreshRuns: document.querySelector('#refresh-runs'),
  runTemplate: document.querySelector('#run-template'),
};

let selectedFiles = new Map();
let refreshTimer;
let hashWorker;
let nextHashRequestId = 1;
const pendingHashes = new Map();

function configurationIsReady() {
  return ['apiBaseUrl', 'cognitoDomain', 'redirectUri']
    .every((name) => typeof config[name] === 'string' && config[name].startsWith('https://'))
    && typeof config.clientId === 'string'
    && /^[a-z0-9]+$/iu.test(config.clientId)
    && Number.isInteger(config.maxGeocodeRequestsPerRun)
    && config.maxGeocodeRequestsPerRun >= -1
    && config.maxGeocodeRequestsPerRun <= 1200;
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function parseJwt(token) {
  try {
    const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(paddedPayload));
  } catch {
    return {};
  }
}

function accessToken() {
  const token = sessionStorage.getItem('mls_access_token');
  const claims = parseJwt(token ?? '');
  if (!token || Number(claims.exp ?? 0) * 1000 <= Date.now() + 30_000) {
    sessionStorage.removeItem('mls_access_token');
    return null;
  }
  return token;
}

function setMessage(message, kind = 'info') {
  elements.message.textContent = message;
  elements.message.className = `notice notice-${kind}`;
  elements.message.hidden = !message;
}

function trustedAwsConsoleLogUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const trustedHostname = hostname === 'console.aws.amazon.com'
      || hostname.endsWith('.console.aws.amazon.com');
    if (
      url.protocol !== 'https:'
      || !trustedHostname
      || url.username
      || url.password
      || (url.port && url.port !== '443')
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function safeBuildStatusCode(build) {
  const directStatus = typeof build?.status === 'string' ? build.status.trim() : '';
  if (Object.hasOwn(buildFailurePresentation, directStatus)) return directStatus;
  const failure = typeof build?.failure === 'string' ? build.failure.trim() : '';
  const legacyMatch = /^AWS processing ended with ([A-Z][A-Z0-9_]{1,63})\.$/u.exec(failure);
  return legacyMatch && Object.hasOwn(buildFailurePresentation, legacyMatch[1])
    ? legacyMatch[1]
    : null;
}

function renderBuildDiagnostic(card, run) {
  if (!failedBuildStates.has(run.state)) return false;
  const diagnostic = card.querySelector('.run-diagnostic');
  const statusCode = safeBuildStatusCode(run.build);
  const safeFailure = statusCode ? buildFailurePresentation[statusCode] : null;
  diagnostic.hidden = false;
  diagnostic.querySelector('.run-diagnostic-title').textContent = run.state === 'VALIDATION_FAILED'
    ? 'Validation did not finish'
    : 'Publication did not finish';
  diagnostic.querySelector('.run-diagnostic-message').textContent = safeFailure
    ? `AWS status: ${safeFailure[0]}. ${safeFailure[1]}`
    : 'Detailed AWS status is not available in this portal. Ask an administrator to inspect AWS before retrying.';

  const logUrl = trustedAwsConsoleLogUrl(run.build?.logsUrl);
  if (logUrl) {
    const link = diagnostic.querySelector('.run-log-link');
    link.href = logUrl;
    link.hidden = false;
  }
  return nonRetryableBuildStatuses.has(statusCode);
}

async function startSignIn() {
  if (!configurationIsReady()) {
    elements.setupWarning.hidden = false;
    return;
  }
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  sessionStorage.setItem('mls_pkce_verifier', verifier);
  sessionStorage.setItem('mls_oauth_state', state);
  const url = new URL('/oauth2/authorize', config.cognitoDomain);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  window.location.assign(url);
}

async function finishSignIn(code, returnedState) {
  const verifier = sessionStorage.getItem('mls_pkce_verifier');
  const expectedState = sessionStorage.getItem('mls_oauth_state');
  sessionStorage.removeItem('mls_pkce_verifier');
  sessionStorage.removeItem('mls_oauth_state');
  if (!verifier || !expectedState) {
    throw new Error('The sign-in session expired. Please sign in again.');
  }
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('The sign-in response could not be verified. Please sign in again.');
  }
  const response = await fetch(new URL('/oauth2/token', config.cognitoDomain), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    throw new Error('Sign-in could not be completed. Please try again.');
  }
  const tokens = await response.json();
  sessionStorage.setItem('mls_access_token', tokens.access_token);
  sessionStorage.setItem('mls_id_token', tokens.id_token);
  history.replaceState({}, '', '/');
}

function signOut() {
  sessionStorage.clear();
  const url = new URL('/logout', config.cognitoDomain);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: config.redirectUri });
  window.location.assign(url);
}

async function api(path, options = {}) {
  const token = accessToken();
  if (!token) {
    renderSession();
    throw new Error('Your session ended. Sign in again to continue.');
  }
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || 'The request could not be completed.');
  }
  return body;
}

function canonicalFileName(name) {
  if (allowedSet.has(name)) return name;
  const withoutDuplicateSuffix = name.replace(/ \(\d+\)(?=\.txt$)/u, '');
  return allowedSet.has(withoutDuplicateSuffix) ? withoutDuplicateSuffix : name;
}

function selectFiles(fileList) {
  const next = new Map(selectedFiles);
  const rejected = [];
  for (const file of fileList) {
    const canonicalName = canonicalFileName(file.name);
    if (!allowedSet.has(canonicalName)) {
      rejected.push(file.name);
      continue;
    }
    if (next.has(canonicalName)) {
      rejected.push(`${file.name} (duplicates ${canonicalName})`);
      continue;
    }
    next.set(canonicalName, { file, canonicalName });
  }
  selectedFiles = next;
  renderChecklist();
  if (rejected.length > 0) {
    setMessage(`Not added: ${rejected.join(', ')}. Only the files in the checklist are accepted.`, 'warning');
  } else {
    setMessage('');
  }
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderChecklist() {
  const useCurrent = elements.useCurrentReferences.checked;
  const commercialSelectedCount = commercialFiles.filter((name) => selectedFiles.has(name)).length;
  elements.checklist.replaceChildren(...allowedFiles.map((name) => {
    const row = document.createElement('tr');
    const selected = selectedFiles.get(name);
    const isCore = coreFiles.includes(name);
    const isReference = referenceFiles.includes(name);
    const isCommercial = commercialFiles.includes(name);
    const required = isCore || (isReference && !useCurrent);
    const status = selected
      ? `${selected.file.name === name ? 'Selected' : `Renamed from ${selected.file.name}`} · ${humanBytes(selected.file.size)}`
      : (isReference && useCurrent
        ? 'Using current copy'
        : (isCommercial && commercialSelectedCount > 0 ? 'Missing from commercial set' : (required ? 'Missing' : 'Optional')));
    row.innerHTML = `<th scope="row"></th><td></td><td></td>`;
    row.children[0].textContent = name;
    row.children[1].textContent = required ? 'Required' : (isReference ? 'Current copy allowed' : 'Optional');
    row.children[2].textContent = status;
    if (selected) row.classList.add('file-ready');
    if (!selected && (required || (isCommercial && commercialSelectedCount > 0))) row.classList.add('file-missing');
    return row;
  }));
  const requiredFiles = [...coreFiles, ...(useCurrent ? [] : referenceFiles)];
  const commercialReady = commercialSelectedCount === 0 || commercialSelectedCount === commercialFiles.length;
  const ready = requiredFiles.every((name) => selectedFiles.has(name)) && commercialReady;
  elements.upload.disabled = !ready;
  elements.clear.disabled = selectedFiles.size === 0;
}

function hashingWorker() {
  if (hashWorker) return hashWorker;
  hashWorker = new Worker('/portal/hash-worker.js', { type: 'module' });
  hashWorker.addEventListener('message', (event) => {
    const request = pendingHashes.get(event.data?.id);
    if (!request) return;
    if (event.data.type === 'progress') {
      request.onProgress(event.data.loaded, event.data.total);
      return;
    }
    pendingHashes.delete(event.data.id);
    if (event.data.type === 'complete') request.resolve(event.data);
    else request.reject(new Error(event.data.message || 'The selected file could not be checked.'));
  });
  hashWorker.addEventListener('error', () => {
    for (const request of pendingHashes.values()) {
      request.reject(new Error('The browser file checker stopped unexpectedly. Refresh and try again.'));
    }
    pendingHashes.clear();
    hashWorker.terminate();
    hashWorker = undefined;
  });
  return hashWorker;
}

async function fileEvidence(file, onProgress) {
  const id = nextHashRequestId;
  nextHashRequestId += 1;
  const evidence = await new Promise((resolve, reject) => {
    pendingHashes.set(id, { resolve, reject, onProgress });
    hashingWorker().postMessage({ id, file });
  });
  return {
    size: file.size,
    sha256: evidence.sha256,
    checksumSha256: evidence.checksumSha256,
    sourceModifiedAt: new Date(file.lastModified).toISOString(),
  };
}

async function uploadSelectedFiles() {
  elements.upload.disabled = true;
  elements.clear.disabled = true;
  try {
    const selected = [...selectedFiles.values()];
    const files = [];
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index];
      const progress = (loaded, total) => {
        const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 100;
        elements.progress.textContent = `Checking ${index + 1} of ${selected.length}: ${entry.canonicalName} (${percent}%)`;
      };
      progress(0, entry.file.size);
      files.push({ name: entry.canonicalName, ...await fileEvidence(entry.file, progress) });
    }
    elements.progress.textContent = 'Preparing the private upload…';
    const created = await api('/runs', {
      method: 'POST',
      body: JSON.stringify({
        files,
        useCurrentReferences: elements.useCurrentReferences.checked,
        note: elements.note.value,
      }),
    });
    for (let index = 0; index < created.uploads.length; index += 1) {
      const upload = created.uploads[index];
      const entry = selectedFiles.get(upload.name);
      elements.progress.textContent = `Uploading ${index + 1} of ${created.uploads.length}: ${upload.name}`;
      const response = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: entry.file });
      if (!response.ok) throw new Error(`${upload.name} could not be uploaded. Try the update again.`);
    }
    elements.progress.textContent = 'Confirming checksums…';
    await api(`/runs/${encodeURIComponent(created.runId)}/complete`, { method: 'POST', body: '{}' });
    selectedFiles = new Map();
    elements.fileInput.value = '';
    elements.note.value = '';
    renderChecklist();
    elements.progress.textContent = '';
    setMessage('The files are safely uploaded. Start validation from Recent imports.', 'success');
    await loadRuns();
  } catch (error) {
    elements.progress.textContent = '';
    setMessage(error.message, 'error');
  } finally {
    renderChecklist();
  }
}

function summaryItem(term, value) {
  const fragment = document.createDocumentFragment();
  const wrapper = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = term;
  dd.textContent = value;
  wrapper.append(dt, dd);
  fragment.append(wrapper);
  return fragment;
}

const VALIDATION_MODE_NORMAL = 'normal';
const VALIDATION_MODE_EMERGENCY_URGENT_ONLY = 'emergency-urgent-only';

async function runAction(runId, action, { validationMode = VALIDATION_MODE_NORMAL } = {}) {
  try {
    let acknowledge = false;
    let acknowledgeGeocodingCost = false;
    let acknowledgedGeocodingRequestCap = null;
    if (action === 'validate') {
      const requestCap = config.maxGeocodeRequestsPerRun;
      const grossMaximum = (requestCap * 0.005).toFixed(2);
      if (validationMode === VALIDATION_MODE_EMERGENCY_URGENT_ONLY) {
        if (requestCap < 0 || requestCap > 1_200) {
          window.alert('Emergency all-or-none validation is available only when the configured Google request ceiling is 1,200 or lower.');
          return;
        }
        const emergencyConfirmed = window.confirm(
          `Emergency mode requires every missing, changed, or expired address to fit within the ${requestCap.toLocaleString()}-request ceiling. If they do not all fit, validation stops without making paid Google requests. Use this only for an explicitly reviewed recovery. Continue?`,
        );
        if (!emergencyConfirmed) return;
      }
      acknowledgeGeocodingCost = window.confirm(
        requestCap === -1
          ? 'Validation processes every missing, changed, or expired service-area address with no request cap. Valid saved coordinates are reused and proactive refreshes stay off. Large imports continue automatically in parts. Google charges depend on the number of needed lookups; there is no fixed per-update cost maximum. Continue?'
          : `Validation checks addresses that need coordinates. It can make at most ${requestCap.toLocaleString()} Google requests for this update (about $${grossMaximum} at the current list price before any credits).${validationMode === VALIDATION_MODE_NORMAL ? ' Any additional missing, changed, or expired addresses are deferred to a later validation; optional proactive refreshes stay off.' : ''} Continue?`,
      );
      if (!acknowledgeGeocodingCost) return;
      acknowledgedGeocodingRequestCap = requestCap;
    }
    if (action === 'approve') {
      acknowledge = window.confirm('Have you opened the report and reviewed its totals?');
      if (!acknowledge) return;
    }
    if (action === 'publish' && !window.confirm('Publish this approved update to the website?')) return;
    const result = await api(`/runs/${encodeURIComponent(runId)}/action`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        acknowledge,
        acknowledgeGeocodingCost,
        acknowledgedGeocodingRequestCap,
        emergencyUrgentOnly: action === 'validate' && validationMode === VALIDATION_MODE_EMERGENCY_URGENT_ONLY,
      }),
    });
    setMessage(result.message || `The update is now ${result.state.toLowerCase().replaceAll('_', ' ')}.`, 'success');
    await loadRuns();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function openReport(runId, includesCommercial = false) {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    setMessage('Your browser blocked the report window. Allow pop-ups for this portal, then try again.', 'error');
    return;
  }
  reportWindow.opener = null;
  reportWindow.document.title = 'Opening MLS review report';
  reportWindow.document.body.textContent = 'Opening your private review report...';
  const commercialWindow = includesCommercial ? window.open('', '_blank') : null;
  if (includesCommercial && !commercialWindow) {
    reportWindow.close();
    setMessage('Your browser blocked the commercial report window. Allow pop-ups for this portal, then try again.', 'error');
    return;
  }
  if (commercialWindow) {
    commercialWindow.opener = null;
    commercialWindow.document.title = 'Opening commercial review report';
    commercialWindow.document.body.textContent = 'Opening your private commercial review report...';
  }
  try {
    const result = await api(`/runs/${encodeURIComponent(runId)}/report-url`);
    reportWindow.location.replace(result.url);
    if (commercialWindow) commercialWindow.location.replace(result.commercialUrl);
  } catch (error) {
    reportWindow.close();
    if (commercialWindow) commercialWindow.close();
    setMessage(error.message, 'error');
  }
}

function actionButton(label, action, runId, className = 'button-secondary', options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${className}`;
  button.textContent = label;
  button.addEventListener('click', () => runAction(runId, action, options));
  return button;
}

function isRenderableRun(run) {
  return Boolean(run)
    && typeof run.runId === 'string'
    && typeof run.state === 'string'
    && typeof run.createdAt === 'string'
    && Number.isFinite(Date.parse(run.createdAt));
}

function renderRun(run) {
  const card = elements.runTemplate.content.firstElementChild.cloneNode(true);
  const [statusLabel, help] = statusPresentation[run.state] ?? [run.state, 'Refresh for the latest status.'];
  card.querySelector('.run-date').textContent = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.createdAt));
  card.querySelector('.run-title').textContent = `${run.fileCount} files · ${humanBytes(run.totalBytes ?? 0)}`;
  const status = card.querySelector('.status-pill');
  status.textContent = statusLabel;
  status.dataset.state = run.state;
  card.querySelector('.run-help').textContent = help;
  if (run.state === 'VALIDATING' && Number.isInteger(run.geocodeBatch?.index) && Number.isInteger(run.geocodeBatch?.count)) {
    card.querySelector('.run-help').textContent = `Processing part ${run.geocodeBatch.index + 1} of ${run.geocodeBatch.count}. Completed coordinates are saved; the remaining parts continue automatically.`;
  }
  const retryBlocked = renderBuildDiagnostic(card, run);
  if (run.note) {
    card.querySelector('.run-note').hidden = false;
    card.querySelector('.run-note').textContent = run.note;
  }

  const summary = card.querySelector('.summary-grid');
  if (run.summary && !run.summary.summaryUnavailable) {
    summary.append(
      summaryItem('Service-area homes', Number(run.summary.serviceAreaListings ?? 0).toLocaleString()),
      summaryItem('Mapped homes', Number(run.summary.mappedListings ?? 0).toLocaleString()),
      summaryItem('Awaiting coordinates', Number(run.summary.awaitingCoordinates ?? 0).toLocaleString()),
      summaryItem('Quarantined', Number(run.summary.quarantinedListings ?? 0).toLocaleString()),
      summaryItem('Remarks held for review', Number(run.summary.remarksSuppressed ?? 0).toLocaleString()),
      summaryItem('Outside Massachusetts removed', Number(run.summary.outsideMassachusettsExcluded ?? 0).toLocaleString()),
    );
    if (run.summary.includesCommercial) {
      summary.append(summaryItem(
        'Commercial listings',
        Number(run.summary.commercialListings ?? 0).toLocaleString(),
      ));
    }
  } else {
    summary.append(
      summaryItem('Reference files', run.usesCurrentReferences ? 'Using current copies' : 'Included in update'),
      summaryItem('Commercial exports', run.includesCommercial ? 'Included as a complete set' : 'Not included'),
      summaryItem('Signed file record', run.manifestSha256 ? 'Verified' : 'Pending'),
    );
  }

  const actions = card.querySelector('.run-actions');
  if ((run.state === 'UPLOADED' || run.state === 'VALIDATION_FAILED') && !retryBlocked) {
    actions.append(actionButton(
      run.state === 'UPLOADED' ? 'Start validation' : 'Try validation again',
      'validate',
      run.runId,
      'button-primary',
      { validationMode: VALIDATION_MODE_NORMAL },
    ));
    if (config.maxGeocodeRequestsPerRun >= 0 && config.maxGeocodeRequestsPerRun <= 1_200) {
      const emergencyValidation = actionButton(
        'Emergency all-or-none',
        'validate',
        run.runId,
        'button-secondary',
        { validationMode: VALIDATION_MODE_EMERGENCY_URGENT_ONLY },
      );
      emergencyValidation.title = 'Require every missing, changed, or expired address to fit within the acknowledged request ceiling.';
      actions.append(emergencyValidation);
    }
  }
  if (['AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHING', 'PUBLISH_FAILED', 'PUBLISHED'].includes(run.state)) {
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'button button-secondary';
    report.textContent = run.includesCommercial ? 'Open full reports' : 'Open full report';
    report.addEventListener('click', () => openReport(run.runId, run.includesCommercial));
    actions.append(report);
  }
  if (run.state === 'AWAITING_REVIEW') {
    actions.append(
      actionButton('Approve update', 'approve', run.runId, 'button-primary'),
      actionButton('Do not use this update', 'reject', run.runId),
    );
  }
  if ((run.state === 'APPROVED' || run.state === 'PUBLISH_FAILED') && !retryBlocked) {
    actions.append(actionButton(run.state === 'APPROVED' ? 'Publish to website' : 'Try publishing again', 'publish', run.runId, 'button-primary'));
  }
  return card;
}

async function loadRuns() {
  if (!accessToken()) return;
  elements.refreshRuns.disabled = true;
  try {
    const { runs } = await api('/runs');
    const displayRuns = Array.isArray(runs) ? runs.filter(isRenderableRun) : [];
    elements.runsList.replaceChildren(...displayRuns.map(renderRun));
    elements.runsEmpty.hidden = displayRuns.length > 0;
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    elements.refreshRuns.disabled = false;
  }
}

function renderSession() {
  const token = accessToken();
  elements.signIn.hidden = Boolean(token);
  elements.signOut.hidden = !token;
  elements.signedOutPanel.hidden = Boolean(token);
  elements.workspace.hidden = !token;
  const claims = parseJwt(sessionStorage.getItem('mls_id_token') ?? '');
  elements.sessionLabel.textContent = token ? (claims.email || 'Signed in') : 'Signed out';
  window.clearInterval(refreshTimer);
  if (token) {
    loadRuns();
    refreshTimer = window.setInterval(loadRuns, 15_000);
  }
}

elements.signIn.addEventListener('click', startSignIn);
elements.signOut.addEventListener('click', signOut);
elements.fileInput.addEventListener('change', () => selectFiles(elements.fileInput.files));
elements.useCurrentReferences.addEventListener('change', renderChecklist);
elements.upload.addEventListener('click', uploadSelectedFiles);
elements.clear.addEventListener('click', () => {
  selectedFiles = new Map();
  elements.fileInput.value = '';
  renderChecklist();
  setMessage('');
});
elements.refreshRuns.addEventListener('click', loadRuns);
elements.dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.fileInput.click();
  }
});
for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('drag-active');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('drag-active');
  });
}
elements.dropZone.addEventListener('drop', (event) => selectFiles(event.dataTransfer.files));

async function initialize() {
  renderChecklist();
  if (!configurationIsReady()) {
    elements.setupWarning.hidden = false;
    elements.signIn.disabled = true;
    return;
  }
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.has('error')) {
    sessionStorage.removeItem('mls_pkce_verifier');
    sessionStorage.removeItem('mls_oauth_state');
    setMessage(parameters.get('error_description') || 'Sign-in was cancelled.', 'error');
    history.replaceState({}, '', '/');
  } else if (parameters.has('code')) {
    try {
      await finishSignIn(parameters.get('code'), parameters.get('state'));
      setMessage('You are signed in.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }
  renderSession();
}

initialize();
