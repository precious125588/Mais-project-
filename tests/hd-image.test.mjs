import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  HD_IMAGE_WIDTH,
  IMAGE_CREDIT_CAPTION,
  imageGalleryCaption,
  prepareHdImage,
} from "../mias/lib/hdImage.js";

test("image gallery captions are only added to the final image", () => {
  assert.equal(imageGalleryCaption(0, 5), undefined);
  assert.equal(imageGalleryCaption(3, 5), undefined);
  assert.equal(imageGalleryCaption(4, 5), IMAGE_CREDIT_CAPTION);
});

test("image preparation upscales small images to the requested HD width", async () => {
  const source = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: { r: 20, g: 40, b: 80 },
    },
  }).png().toBuffer();
  const result = await prepareHdImage(source);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.upscaled, true);
  assert.equal(metadata.width, HD_IMAGE_WIDTH);
  assert.equal(metadata.height, 1170);
});