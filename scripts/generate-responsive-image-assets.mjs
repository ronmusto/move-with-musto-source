import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(workspaceRoot, 'src/lib/responsive-image-assets.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

for (const [publicPath, imageConfig] of Object.entries(manifest)) {
    const sourcePath = path.join(workspaceRoot, 'public', publicPath.replace(/^\//, ''));
    const extension = path.extname(sourcePath);
    const basePath = sourcePath.slice(0, -extension.length);

    for (const width of imageConfig.widths) {
        const outputPath = `${basePath}-${width}w.webp`;

        await sharp(sourcePath)
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: imageConfig.quality ?? 76, effort: 6, smartSubsample: true })
            .toFile(outputPath);

        console.log(path.relative(workspaceRoot, outputPath));
    }
}
