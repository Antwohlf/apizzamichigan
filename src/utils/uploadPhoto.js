import { supabase } from '../supabaseClient'

const REVIEW_PHOTO_BUCKET = 'review-photos'
const MAX_DIMENSION = 1920
const DEFAULT_QUALITY = 0.8
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const HEIC_IMAGE_EXTENSIONS = new Set(['heic', 'heif'])
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(['avif'])

const getFileExtension = file => {
  const name = typeof file?.name === 'string' ? file.name : ''
  const extension = name.split('.').pop()
  return extension && extension !== name ? extension.toLowerCase() : ''
}

export const isSupportedReviewPhotoFile = file => {
  if (!file) return false
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : ''
  const extension = getFileExtension(file)
  if (HEIC_IMAGE_EXTENSIONS.has(extension)) return true
  if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extension)) return false
  if (type.startsWith('image/')) return true
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension)
}

export const getUnsupportedReviewPhotoMessage = file => {
  return `${file?.name || 'This file'} is not a supported image. Use JPG, PNG, WebP, GIF, HEIC, or HEIF.`
}

const hasCanvasSupport = () => typeof document !== 'undefined' && typeof document.createElement === 'function'

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    if (typeof canvas.convertToBlob === 'function') {
      canvas
        .convertToBlob({ type, quality })
        .then(resolve)
        .catch(reject)
      return
    }

    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to convert canvas to blob'))
      }, type, quality)
      return
    }

    reject(new Error('Canvas toBlob is not supported in this environment'))
  })

async function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof URL === 'undefined') {
      reject(new Error('window is not available'))
      return
    }

    const url = URL.createObjectURL(file)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = error => {
      URL.revokeObjectURL(url)
      reject(error instanceof Error ? error : new Error('Unable to decode image file'))
    }
    image.src = url
  })
}

async function convertHeicToJpeg(file) {
  const extension = getFileExtension(file)
  if (!HEIC_IMAGE_EXTENSIONS.has(extension)) {
    return file
  }

  let heic2any
  try {
    const module = await import('heic2any')
    heic2any = module.default || module
  } catch (err) {
    throw new Error('HEIC conversion support could not be loaded. Try again, or export this photo as JPG first.')
  }

  try {
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    })
    const blob = Array.isArray(converted) ? converted[0] : converted
    if (!blob) {
      throw new Error('HEIC conversion returned no image data')
    }
    const nextName = `${file.name.replace(/\.[^/.]+$/, '') || 'review-photo'}.jpg`
    return new File([blob], nextName, { type: 'image/jpeg' })
  } catch (err) {
    throw new Error(`${file.name || 'This HEIC photo'} could not be converted. Export it as JPG or PNG first if it came from iCloud or Apple Photos.`)
  }
}

async function downscaleToWebP(file, maxDimension = MAX_DIMENSION, quality = DEFAULT_QUALITY) {
  if (!isSupportedReviewPhotoFile(file)) {
    throw new Error(`${file.name || 'This file'} is not a supported image. Use JPG, PNG, WebP, GIF, HEIC, or HEIF.`)
  }
  if (!hasCanvasSupport()) {
    throw new Error('Canvas support is required to process review photos')
  }

  let image
  let readableFile
  try {
    readableFile = await convertHeicToJpeg(file)
    image = await loadImage(readableFile)
  } catch (err) {
    if (err instanceof Error && err.message) {
      throw err
    }
    throw new Error(`${file.name || 'This photo'} could not be read by the browser. Use JPG or PNG if this came from Apple Photos or iCloud.`)
  }
  const maxSide = Math.max(image.width, image.height)
  const scale = maxSide > maxDimension ? maxDimension / maxSide : 1

  const targetWidth = Math.max(1, Math.round(image.width * scale))
  const targetHeight = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Unable to acquire 2D context')
  }

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)
  const blob = await toBlob(canvas, 'image/webp', quality)

  const nextName = `${readableFile.name.replace(/\.[^/.]+$/, '') || 'review-photo'}.webp`
  return new File([blob], nextName, { type: 'image/webp' })
}

const blobToBase64 = blob =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const [, encoded = ''] = result.split(',')
      resolve(encoded)
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read photo data'))
    reader.readAsDataURL(blob)
  })

function sanitizeSegment(segment) {
  return String(segment || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'photo'
}

function randomSuffix() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function uploadReviewPhoto(file, { reviewId, bucket = REVIEW_PHOTO_BUCKET, prefix } = {}) {
  if (typeof File !== 'undefined' && !(file instanceof File)) {
    throw new TypeError('Expected a File for uploadReviewPhoto')
  }

  if (!supabase?.storage) {
    throw new Error('Supabase client is not initialised')
  }

  const processed = await downscaleToWebP(file)
  const safePrefix = sanitizeSegment(prefix || reviewId || 'review')
  const fileName = `${sanitizeSegment(processed.name.replace(/\.webp$/i, ''))}-${randomSuffix()}.webp`
  const storagePath = `${safePrefix}/${fileName}`

  const { error } = await supabase.storage.from(bucket).upload(storagePath, processed, {
    cacheControl: '3600',
    contentType: processed.type,
    upsert: false,
  })

  if (error) {
    throw error
  }

  return {
    path: storagePath,
    size: processed.size,
    bucket,
    mimeType: processed.type,
  }
}

export async function prepareReviewPhotoUpload(file, { reviewId, bucket = REVIEW_PHOTO_BUCKET, prefix } = {}) {
  if (typeof File !== 'undefined' && !(file instanceof File)) {
    throw new TypeError('Expected a File for prepareReviewPhotoUpload')
  }

  const processed = await downscaleToWebP(file)
  const safePrefix = sanitizeSegment(prefix || reviewId || 'review')
  const fileName = `${sanitizeSegment(processed.name.replace(/\.webp$/i, ''))}-${randomSuffix()}.webp`
  const storagePath = `${safePrefix}/${fileName}`
  const dataBase64 = await blobToBase64(processed)

  return {
    path: storagePath,
    size: processed.size,
    bucket,
    mimeType: processed.type,
    dataBase64,
  }
}

export { REVIEW_PHOTO_BUCKET }
