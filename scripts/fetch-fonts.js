// Скачивает кириллические шрифты из npm-пакетов @fontsource и собирает fonts.css.
// Запускается в GitHub Actions перед сборкой. Если какой-то шрифт не скачался — пропускает его
// (приложение подгрузит его из Google Fonts, если есть интернет).
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FONTS = [
  ['Roboto', 'roboto'], ['Open Sans', 'open-sans'], ['Montserrat', 'montserrat'],
  ['PT Sans', 'pt-sans'], ['PT Serif', 'pt-serif'], ['Noto Sans', 'noto-sans'],
  ['Noto Serif', 'noto-serif'], ['Ubuntu', 'ubuntu'], ['Lora', 'lora'],
  ['Merriweather', 'merriweather'], ['Playfair Display', 'playfair-display'],
  ['Raleway', 'raleway'], ['Nunito', 'nunito'], ['Rubik', 'rubik'], ['Oswald', 'oswald'],
  ['Comfortaa', 'comfortaa'], ['Fira Sans', 'fira-sans'], ['Exo 2', 'exo-2'],
  ['Philosopher', 'philosopher'], ['Marck Script', 'marck-script'], ['Pacifico', 'pacifico'],
  ['Caveat', 'caveat'], ['Lobster', 'lobster'], ['Russo One', 'russo-one'], ['Jura', 'jura'],
  ['Play', 'play'], ['Cormorant', 'cormorant'], ['Spectral', 'spectral'],
  ['Alegreya', 'alegreya'], ['Bad Script', 'bad-script'], ['Neucha', 'neucha'],
  ['Amatic SC', 'amatic-sc'], ['Press Start 2P', 'press-start-2p'], ['Yeseva One', 'yeseva-one'],
  ['El Messiri', 'el-messiri'], ['Scada', 'scada'], ['Kurale', 'kurale'], ['Forum', 'forum'],
  ['Manrope', 'manrope'], ['Inter', 'inter'],
];

const outDir = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'fonts');
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-'));
let css = '';
let ok = 0;

for (const [family, id] of FONTS) {
  try {
    const dir = path.join(tmp, id);
    fs.mkdirSync(dir);
    execSync(`npm pack @fontsource/${id} --silent`, { cwd: dir, stdio: 'pipe' });
    const tgz = fs.readdirSync(dir).find((f) => f.endsWith('.tgz'));
    execSync(`tar -xzf ${tgz}`, { cwd: dir, stdio: 'pipe' });
    const files = path.join(dir, 'package', 'files');
    let got = 0;
    for (const weight of [400, 700]) {
      for (const subset of ['cyrillic', 'latin']) {
        const name = `${id}-${subset}-${weight}-normal.woff2`;
        const src = path.join(files, name);
        if (!fs.existsSync(src)) continue;
        fs.copyFileSync(src, path.join(outDir, name));
        const range = subset === 'cyrillic'
          ? 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'
          : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
        css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;`
          + `src:url(${name}) format('woff2');unicode-range:${range}}\n`;
        got++;
      }
    }
    if (got) ok++;
    else console.log('нет файлов для', family);
  } catch (e) {
    console.log('пропущен', family, String(e.message).split('\n')[0]);
  }
}

fs.writeFileSync(path.join(outDir, 'fonts.css'), css);
console.log(`Готово: ${ok}/${FONTS.length} шрифтов`);
