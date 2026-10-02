const fs = require('fs');
const path = require('path');
const https = require('https');

const assets = [
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/logo.png', dest: 'public/proposal/whyte/logo.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/logo-ftr.png', dest: 'public/proposal/whyte/logo-footer.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/slider-1-touch.webp', dest: 'public/proposal/whyte/hero-touch.webp' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/products.jpg', dest: 'public/proposal/whyte/products-showcase.jpg' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/home-touchswitch.png', dest: 'public/proposal/whyte/tactus/tactus-touch-switch.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/breathe.png', dest: 'public/proposal/whyte/tactus/regno-screen.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/curtains-blinds.png', dest: 'public/proposal/whyte/automation/curtains-blinds.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/smart-glass.png', dest: 'public/proposal/whyte/automation/smart-glass.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/handle-lock.png', dest: 'public/proposal/whyte/automation/smart-lock.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/home-sensor.png', dest: 'public/proposal/whyte/automation/home-sensor.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/home-doorbell.png', dest: 'public/proposal/whyte/automation/home-doorbell.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/alexa.png', dest: 'public/proposal/whyte/automation/voice-alexa.png' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/img-home.jpg', dest: 'public/proposal/whyte/solutions/img-home.jpg' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/img-office.jpg', dest: 'public/proposal/whyte/solutions/img-office.jpg' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/img-hotel.jpg', dest: 'public/proposal/whyte/solutions/img-hotel.jpg' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/img-hospital.jpg', dest: 'public/proposal/whyte/solutions/img-hospital.jpg' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/screen-1.jpg', dest: 'public/proposal/whyte/screens/screen-1.jpg' },
  { url: 'https://whyte.co.in/wp-content/uploads/2024/04/screen-2.jpg', dest: 'public/proposal/whyte/screens/screen-2.jpg' }
];

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Failed to get '${url}' (${res.statusCode})`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          console.log('Downloaded:', destPath);
          resolve();
        });
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log('Starting download of official Whyte assets...');
  for (const item of assets) {
    const fullPath = path.resolve(process.cwd(), item.dest);
    try {
      await download(item.url, fullPath);
    } catch (e) {
      console.warn(`Warning downloading ${item.url}:`, e.message);
    }
  }
  console.log('Asset downloads complete.');
}

run();
