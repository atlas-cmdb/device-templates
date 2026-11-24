import sharp from 'sharp';

/** Longest side of a stored image. Plenty for a 19" faceplate in VR, small enough to keep the repo light. */
export const MAX_IMAGE_SIDE = 2400;
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

/** Normalise any supported input (png/jpg/webp/gif/svg/tiff) to the stored WebP format. */
export async function convertImage(from, to) {
	await sharp(from, { failOn: 'none', limitInputPixels: 268402689 })
		.rotate() // honour EXIF orientation from phone photos
		.resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 82, alphaQuality: 90, effort: 5, smartSubsample: true })
		.toFile(to);
}

export async function imageInfo(file) {
	const meta = await sharp(file).metadata();
	return { width: meta.width, height: meta.height, format: meta.format };
}
