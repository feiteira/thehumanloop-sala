// A folder's photo, made small: the centre square of the picture, at most 256 px, as JPEG.
// It is kept in the practice (encrypted), so it stays a few kilobytes.

export async function squarePhoto(bytes: Uint8Array): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(256, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}
