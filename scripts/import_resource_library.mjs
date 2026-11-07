import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localEnvPath = path.join(projectRoot, '.env.local');
const manifestPath = path.join(projectRoot, 'supabase', 'seed_resource_manifest.json');
const MAX_RESOURCE_BYTES = 50_000_000;

async function readLocalEnv() {
  let contents;
  try { contents = await readFile(localEnvPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith('#')) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const localEnv = await readLocalEnv();
const env = { ...localEnv, ...process.env };
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const sourceDir = env.RESOURCE_SOURCE_DIR || path.join(env.USERPROFILE || env.HOME || projectRoot, 'Downloads');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
function sourcePathFor(source) {
  return source.localSourcePath
    ? path.resolve(projectRoot, source.localSourcePath)
    : path.join(sourceDir, source.sourceFile);
}

function selectedSources() {
  const onlyIndex = process.argv.indexOf('--only');
  if (onlyIndex === -1) return manifest.sources;
  const sourceFile = process.argv[onlyIndex + 1];
  const source = manifest.sources.find(item => item.sourceFile === sourceFile);
  if (!source) throw new Error(`No manifest resource matches --only ${sourceFile || '(missing filename)'}.`);
  return [source];
}

const sources = selectedSources();
const pageCounts = {
  'S.Chand Physics.pdf': 369,
  'S.CHAND X CHEMISTRY.pdf': 369,
  'SCIENCE Most Important Questions (Prashant Kirad).pdf': 40,
  'Ncert class 10 science exemplar.pdf': 223
};

async function checkSources(items = sources) {
  for (const source of items) {
    const sourcePath = sourcePathFor(source);
    const fileInfo = await stat(sourcePath);
    const file = await open(sourcePath, 'r');
    const signature = Buffer.alloc(5);
    try { await file.read(signature, 0, signature.length, 0); }
    finally { await file.close(); }
    if (signature.toString('ascii') !== '%PDF-') throw new Error(`${source.sourceFile} does not have a PDF signature.`);
    const pageCount = pageCounts[source.sourceFile];
    if (!pageCount) throw new Error(`${source.sourceFile} is missing a verified page count.`);
    for (const range of source.ranges) {
      if (range.subject === 'Biology') throw new Error(`${source.sourceFile} includes a Biology mapping; current batch must exclude Biology.`);
      if (!Number.isInteger(range.startPage) || !Number.isInteger(range.endPage) || range.startPage < 1 || range.endPage < range.startPage || range.endPage > pageCount) {
        throw new Error(`${source.sourceFile} has an invalid page range for ${range.chapterName}.`);
      }
    }
    if (fileInfo.size > MAX_RESOURCE_BYTES) throw new Error(`${source.sourceFile} exceeds the configured 50 MB Supabase limit.`);
    console.log(`Checked ${source.sourceFile}: ${pageCount} pages, ${source.ranges.length} chapter ranges, ${Math.round(fileInfo.size / 1024)} KB.`);
  }
}

if (process.argv.includes('--check')) {
  await checkSources();
  console.log('Source check complete. No Biology resources are included.');
  process.exit(0);
}

const required = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ADMIN_USER_ID'];
const missing = required.filter(key => !env[key]);
if (!supabaseUrl) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL in .env.local)');
if (missing.length) {
  console.error(`Missing required configuration: ${missing.join(', ')}`);
  console.error('Keep SUPABASE_SERVICE_ROLE_KEY server-side in .env.local or the process environment. Never use a VITE_ prefix or paste the key into chat.');
  process.exit(1);
}

await checkSources(sources);
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let uploaded = 0;
let skipped = 0;
for (const source of sources) {
  const sourcePath = sourcePathFor(source);
  const bytes = await readFile(sourcePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { data: duplicate, error: lookupError } = await supabase
    .from('resource_documents').select('id').eq('sha256_hash', hash).maybeSingle();
  if (lookupError) throw new Error(`${source.sourceFile}: ${lookupError.message}`);
  if (duplicate) {
    console.log(`Skipped duplicate: ${source.sourceFile}`);
    skipped += 1;
    continue;
  }

  const categoryPath = source.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const storagePath = `${env.SUPABASE_ADMIN_USER_ID}/${categoryPath}/${hash.slice(0, 16)}-${source.sourceFile.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
  const { error: uploadError } = await supabase.storage.from('study-resources').upload(storagePath, bytes, {
    contentType: 'application/pdf', cacheControl: '300', upsert: false
  });
  if (uploadError) throw new Error(`${source.sourceFile}: Storage upload failed: ${uploadError.message}`);

  const firstRange = source.ranges[0];
  const record = {
    category: source.category,
    subject: source.subject,
    chapter_id: firstRange.chapterId,
    chapter_name: firstRange.chapterName,
    display_name: source.displayName,
    file_name: source.sourceFile,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: bytes.byteLength,
    page_count: pageCounts[source.sourceFile],
    chapter_pages: [],
    chapter_ranges: source.ranges,
    sha256_hash: hash,
    detected_chapters: [...new Set(source.ranges.map(range => range.chapterId))],
    published: true,
    created_by: env.SUPABASE_ADMIN_USER_ID
  };
  const { error: insertError } = await supabase.from('resource_documents').insert(record);
  if (insertError) {
    await supabase.storage.from('study-resources').remove([storagePath]);
    throw new Error(`${source.sourceFile}: Metadata insert failed: ${insertError.message}`);
  }
  console.log(`Uploaded ${source.sourceFile} (${source.ranges.length} chapter/page mappings)`);
  uploaded += 1;
}

console.log(`Finished: ${uploaded} uploaded, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped.`);
