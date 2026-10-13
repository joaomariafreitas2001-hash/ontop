// Downloads the offline English speech model (Vosk small en-us 0.15, ~40 MB,
// Apache-2.0, https://alphacephei.com/vosk/models) and repacks it as
// models/en-us.tar.gz, the format vosk-browser loads. Skips if already present.
//   npm run fetch-model

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const NAME = 'vosk-model-small-en-us-0.15';
const OUT = path.join(__dirname, '..', 'models', 'en-us.tar.gz');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        got += chunk.length;
        if (total) process.stdout.write(`\r  ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => { process.stdout.write('\n'); file.close(resolve); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  if (fs.existsSync(OUT)) {
    console.log(`Model already present: ${path.relative(process.cwd(), OUT)}`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ontop-model-'));
  const zip = path.join(tmp, 'model.zip');
  console.log(`Downloading ${URL}`);
  await download(URL, zip);
  // bsdtar (Windows 10+, macOS) and GNU tar with unzip support both read zip files.
  execFileSync('tar', ['-xf', zip, '-C', tmp]);
  if (!fs.existsSync(path.join(tmp, NAME))) throw new Error('Unexpected archive layout');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync('tar', ['-czf', OUT, '-C', tmp, NAME]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Saved ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
})().catch((e) => {
  console.error('fetch-model failed:', e.message);
  process.exit(1);
});
