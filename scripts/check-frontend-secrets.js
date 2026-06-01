/**
 * Fail CI / pre-commit if obvious secrets appear under src/ or public/.
 * API keys and DB credentials must live in backend .env only; frontend uses REACT_APP_* for non-sensitive config.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src', 'public'].map((d) => path.join(ROOT, d));

const PATTERNS = [
  { re: /GEMINI_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/i, name: 'hardcoded GEMINI_API_KEY' },
  { re: /sk-[A-Za-z0-9]{20,}/, name: 'OpenAI-style sk- key' },
  { re: /AIza[0-9A-Za-z_-]{30,}/, name: 'Google API key (AIza…)' },
  { re: /postgresql:\/\//i, name: 'postgres connection string' },
  { re: /SUPABASE_(SERVICE_ROLE|JWT_SECRET)\s*[:=]\s*['"][^'"]+['"]/i, name: 'Supabase secret in frontend' },
];

const IGNORE_PATH_PARTS = ['check-frontend-secrets.js', '.test.', '__tests__'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(js|jsx|ts|tsx|json|html|css|env)$/i.test(name)) {
      out.push(p);
    }
  }
  return out;
}

let bad = [];
for (const d of SCAN_DIRS) {
  for (const file of walk(d)) {
    if (IGNORE_PATH_PARTS.some((x) => file.includes(x))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const { re, name } of PATTERNS) {
      if (re.test(text)) {
        bad.push({ file: path.relative(ROOT, file), name });
      }
    }
  }
}

if (bad.length) {
  console.error('[check-frontend-secrets] Potential secrets in frontend bundle sources:');
  for (const b of bad) console.error(`  - ${b.file}: ${b.name}`);
  process.exit(1);
}
console.log('[check-frontend-secrets] OK — no obvious secret patterns in src/ or public/.');
