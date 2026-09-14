/**
 * One-shot asset optimizer: turns the heavy 3MB upload banners into
 * lightweight JPEGs for the GTA-style loading screen (fast 6s show).
 */
import sharp from "sharp";

await sharp("upload/BANNER1.png")
  .resize({ width: 1600, withoutEnlargement: true })
  .grayscale()
  .jpeg({ quality: 78, mozjpeg: true })
  .toFile("public/banner1.jpg");

await sharp("upload/BANNER2.png")
  .resize({ width: 1600, withoutEnlargement: true })
  .grayscale()
  .jpeg({ quality: 78, mozjpeg: true })
  .toFile("public/banner2.jpg");

console.log("banners optimized");
