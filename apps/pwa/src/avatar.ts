/**
 * Shrinking a face to a face.
 *
 * A phone photograph is several megabytes, and this is drawn at thirty pixels. Sending the
 * original would be slow to upload, slow to load on every card, and stored forever — so it
 * is drawn to a canvas at the size it is used and sent as a WebP. A square crop from the
 * centre, because a face is usually in the middle of a picture of a person.
 */
export const AVATAR_PIXELS = 256

export async function shrinkToAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_PIXELS
  canvas.height = AVATAR_PIXELS

  const context = canvas.getContext('2d')
  if (!context) throw new Error('this browser would not draw the picture')
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_PIXELS,
    AVATAR_PIXELS,
  )
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.85),
  )
  if (!blob) throw new Error('this browser would not make the picture')
  return blob
}
