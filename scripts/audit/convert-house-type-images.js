const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const SRC = "C:/Users/ADMIN/AppData/Local/Temp/claude/c--Project-whyte-quotation/59afa953-0f65-436a-aeee-33eb791a3494/scratchpad/house-type-images-src";
const OUT = path.join(__dirname, "../../public/house-type-images");

const map = {
  "1-bhk": "1bhk_v2.jpg",
  "2-bhk": "2bhk_v4.jpg",
  "3-bhk": "3bhk_v3.jpg",
  "4-bhk": "4bhk_v2.jpg",
  villa: "villa.jpg",
  penthouse: "penthouse.jpg",
  "residential-apartment": "residential.jpg",
  "luxury-villa": "luxuryvilla.jpg",
  "commercial-retail": "retail_v2.jpg",
  "corporate-office": "office.jpg",
  "hospitality-hotel": "hotel.jpg",
};

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  for (const [out, src] of Object.entries(map)) {
    const inputPath = path.join(SRC, src);
    const outputPath = path.join(OUT, out + ".webp");
    await sharp(inputPath).resize({ width: 1200, withoutEnlargement: false }).webp({ quality: 80 }).toFile(outputPath);
    const meta = await sharp(outputPath).metadata();
    console.log(out, meta.width, meta.height, (fs.statSync(outputPath).size / 1024).toFixed(0) + "KB");
  }
})();
