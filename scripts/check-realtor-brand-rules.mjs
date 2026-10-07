#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const sourceDirs = ['src'];
const brandImageRoot = join(rootDir, 'public', 'images', 'brand');
const checkedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.mdx', '.json']);
const allowedMarks = new Set(['REALTOR®', 'REALTORS®', 'REALTOR-ASSOCIATE®']);
const allowedLogoHosts = new Set(['nar.realtor', 'www.nar.realtor', 'realtor.com', 'www.realtor.com']);

const problems = [];
const files = [];

function walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!['node_modules', '.next', 'out', 'coverage'].includes(entry.name)) {
                walk(fullPath);
            }
            continue;
        }

        if (
            entry.isFile() &&
            checkedExtensions.has(extname(entry.name)) &&
            !entry.name.endsWith('.generated.ts')
        ) {
            files.push(fullPath);
        }
    }
}

function addProblem(file, line, message, sample) {
    const repoPath = relative(rootDir, file).replaceAll('\\', '/');
    problems.push({ repoPath, line, message, sample: sample.trim() });
}

function stripIgnorableText(line) {
    return line
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '')
        .replace(/\/images\/[^\s"'`)},]+/gi, '')
        .replace(/app:\/\/[^\s"'`)},]+/gi, '');
}

function isAllowedLogoHref(href) {
    try {
        const parsed = new URL(href);
        return allowedLogoHosts.has(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function checkWordMarks(file, content) {
    const markPattern =
        /(^|[^A-Za-z0-9_./-])(realtor(?:s|-associate)?®?|REALTOR(?:S|-ASSOCIATE)?®?)(?=$|[^A-Za-z0-9_./-])/g;
    const descriptorPatterns = [
        {
            pattern:
                /\b(best|top|number\s*1|#1|leading|premier|luxury|local|neighborhood|trusted|expert|experienced|preferred|your|my|our)\s+REALTORS?®/i,
            message:
                'Do not combine REALTOR marks with descriptive, possessive, geographic, or superlative phrases.',
        },
        {
            pattern:
                /\bREALTORS?®\s+(agent|broker|professional|expert|specialist|service|services|team|property|properties|business)\b/i,
            message:
                'Do not use REALTOR as a generic job title, service, specialty, business, or property descriptor.',
        },
        {
            pattern:
                /\bREALTORS?®\s*[-/]\s*(agent|broker|builder|insurance|insurer|lender|mortgage|staging|web|website)\b/i,
            message:
                'Do not join REALTOR marks to other occupations, services, or business lines.',
        },
    ];

    content.split(/\r?\n/).forEach((rawLine, index) => {
        const line = stripIgnorableText(rawLine);
        let match;

        while ((match = markPattern.exec(line)) !== null) {
            const mark = match[2];
            if (!allowedMarks.has(mark)) {
                addProblem(
                    file,
                    index + 1,
                    'Use REALTOR marks only as REALTOR®, REALTORS®, or REALTOR-ASSOCIATE® in visible source copy.',
                    rawLine,
                );
            }
        }

        for (const { pattern, message } of descriptorPatterns) {
            if (pattern.test(line)) {
                addProblem(file, index + 1, message, rawLine);
            }
        }
    });
}

function checkLinkedLogos(file, content) {
    const linkedLogoPattern =
        /<a\b[^>]*href=(["'])(.*?)\1[^>]*>[\s\S]{0,1200}?(?:realtor|REALTOR)[\s\S]{0,1200}?<\/a>/gi;
    let match;

    while ((match = linkedLogoPattern.exec(content)) !== null) {
        const href = match[2];
        if (!isAllowedLogoHref(href)) {
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            addProblem(
                file,
                line,
                'Do not hyperlink a REALTOR logo or mark except to nar.realtor or realtor.com.',
                match[0].split(/\r?\n/)[0],
            );
        }
    }
}

function checkRealtorImageAlt(file, content) {
    const realtorImagePattern =
        /<(?:Image|img)\b(?=[^>]*(?:src=\{?["'][^"']*realtor[^"']*["']\}?|realtorLogo))[^>]*>/gi;
    let match;

    while ((match = realtorImagePattern.exec(content)) !== null) {
        const tag = match[0];
        const hasLiteralMembershipAlt = /alt=\{?["'][^"']*REALTOR®[^"']*["']\}?/i.test(tag);
        const hasProfileMembershipAlt = /alt=\{profile\.assets\.realtorLogo\.alt\}/.test(tag);
        if (!hasLiteralMembershipAlt && !hasProfileMembershipAlt) {
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            addProblem(
                file,
                line,
                'REALTOR logo images need alt text that identifies the REALTOR® logo or NAR membership.',
                tag,
            );
        }
    }
}

function checkBrandAssetPaths(dir = brandImageRoot) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            checkBrandAssetPaths(fullPath);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const repoRelative = relative(brandImageRoot, fullPath).replaceAll('\\', '/');
        const normalized = repoRelative.toLowerCase();
        const mentionsRealtor = normalized.includes('realtor');
        const mentionsBrokerage = normalized.includes('century') || normalized.includes('c21') ||
            normalized.includes('dream-seekers');

        if (mentionsRealtor && !normalized.startsWith('realtor/')) {
            addProblem(
                fullPath,
                1,
                'REALTOR logo assets must live under public/images/brand/realtor/.',
                repoRelative,
            );
        }

        if (mentionsRealtor && mentionsBrokerage) {
            addProblem(
                fullPath,
                1,
                'Do not create combined REALTOR and brokerage logo assets or lockups.',
                repoRelative,
            );
        }
    }
}

for (const dir of sourceDirs) {
    walk(join(rootDir, dir));
}

for (const file of files) {
    const content = readFileSync(file, 'utf8');
    checkWordMarks(file, content);
    checkLinkedLogos(file, content);
    checkRealtorImageAlt(file, content);
}

checkBrandAssetPaths();

if (problems.length > 0) {
    console.error('REALTOR brand compliance failed.');
    console.error('Review docs/brand-compliance-rules.md before changing public copy or logo placement.\n');
    for (const problem of problems) {
        console.error(`${problem.repoPath}:${problem.line} ${problem.message}`);
        if (problem.sample) {
            console.error(`  ${problem.sample}`);
        }
    }
    process.exitCode = 1;
} else {
    console.log(`REALTOR brand compliance passed (${files.length} files scanned).`);
}
