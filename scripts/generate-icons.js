const sharp = require('sharp');
const path = require('path');

const INPUT = path.join(__dirname, '../images/SV_Logo_PrimaryCircle_green.svg');

const icons = [
  { out: '../images/icon-192.png', size: 192 },
  { out: '../images/icon-512.png', size: 512 },
  { out: '../images/apple-touch-icon.png', size: 180 },
];

(async () => {
  for (const icon of icons) {
    await sharp(INPUT)
      .resize(icon.size, icon.size)
      .png()
      .toFile(path.join(__dirname, icon.out));
    console.log('Generated', icon.out);
  }
})();
