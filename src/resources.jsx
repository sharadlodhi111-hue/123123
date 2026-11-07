import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, FileText, Folder, FolderOpen, LoaderCircle, Maximize, Minimize, Pencil, Search, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './backend';
import { chapterList } from './syllabus';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const BUCKET = 'study-resources';
const CATEGORIES = [
  { key: 'CHAPTERS', title: 'CHAPTERS', detail: 'Chapter-wise learning material', number: '01' },
  { key: 'SHORT NOTES', title: 'SHORT NOTES', detail: 'Quick subject and chapter notes', number: '02' },
  { key: 'IMPORTANT QUESTIONS (PYQ)', title: 'IMPORTANT QUESTIONS (PYQ)', detail: 'Board questions and answer keys', number: '03' },
  { key: 'NCERT EXEMPLAR', title: 'NCERT EXEMPLAR', detail: 'Chapter-wise exemplar questions', number: '04' }
];
const SUBJECTS = ['Physics', 'Chemistry', 'Biology'];
const EXTRA_FOLDERS = [
  { id: 'Science-Physics-extra-sources-energy', subject: 'Physics', group: 'Physics', name: 'Sources of Energy · Supplementary' },
  { id: 'Science-Physics-extra-practice', subject: 'Physics', group: 'Physics', name: 'Additional Physics practice' },
  { id: 'Science-Chemistry-extra-practice', subject: 'Chemistry', group: 'Chemistry', name: 'Additional Chemistry practice' },
  { id: 'Science-Biology-extra-natural-resources', subject: 'Biology', group: 'Biology', name: 'Management of Natural Resources · Supplementary' },
  ...SUBJECTS.map(subject => ({ id: `Science-${subject}-cross-subject-exemplar`, subject, group: subject, name: 'Cross-subject sample papers & references' }))
];
const ALL_FOLDERS = [...chapterList, ...EXTRA_FOLDERS];
const folderSubject = chapter => chapter.group || chapter.subject;
const cleanText = value => (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const safeFileName = value => value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-130) || 'resource.pdf';

function groupChapterPages(pages, subject) {
  const ranges = [];
  for (const item of pages) {
    const chapter = ALL_FOLDERS.find(entry => entry.id === item.chapterId);
    const last = ranges[ranges.length - 1];
    if (last && last.chapterId === item.chapterId && last.endPage + 1 === item.page) last.endPage = item.page;
    else ranges.push({ subject: chapter ? folderSubject(chapter) : subject, chapterId: item.chapterId, chapterName: chapter?.name || 'Science chapter', startPage: item.page, endPage: item.page });
  }
  return ranges;
}

function documentRanges(document) {
  if (Array.isArray(document.chapter_ranges) && document.chapter_ranges.length) return document.chapter_ranges;
  if (Array.isArray(document.chapter_pages) && document.chapter_pages.length) return groupChapterPages(document.chapter_pages, document.subject);
  return [{ subject: document.subject, chapterId: document.chapter_id, chapterName: document.chapter_name, startPage: 1, endPage: document.page_count || 1 }];
}

function rangesForChapter(document, subject, id) {
  return documentRanges(document).filter(range => range.subject === subject && range.chapterId === id);
}

function pagesFromRanges(ranges, totalPages = 10000) {
  const pages = new Set();
  for (const range of ranges) {
    const start = Math.max(1, Number(range.startPage) || 1);
    const end = Math.min(totalPages, Number(range.endPage) || start);
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function displayPageRanges(ranges) {
  return ranges.map(range => range.startPage === range.endPage ? `${range.startPage}` : `${range.startPage}–${range.endPage}`).join(', ');
}

async function inspectPdf(file, subject, fallbackChapterId) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const subjectChapters = ALL_FOLDERS.filter(chapter => folderSubject(chapter) === subject);
  const pages = [];
  const detected = new Set();
  let currentChapterId = fallbackChapterId;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = (await page.getTextContent()).items.map(item => item.str || '').join(' ');
      const normalizedHeading = cleanText(text.slice(0, 700));
      const chapter = subjectChapters.find(item => normalizedHeading.includes(cleanText(item.name)));
      if (chapter) { currentChapterId = chapter.id; detected.add(chapter.id); }
      pages.push({ page: pageNumber, chapterId: currentChapterId });
      page.cleanup();
    }
    return { pageCount: pdf.numPages, pages, chapterRanges: groupChapterPages(pages, subject), detectedChapters: [...detected] };
  } finally { await pdf.destroy(); }
}

async function sha256(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function ResourceLibrary({ auth }) {
  const [category, setCategory] = useState(CATEGORIES[0].key);
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [chapterId, setChapterId] = useState(chapterList.find(chapter => chapter.group === SUBJECTS[0])?.id || '');
  const [search, setSearch] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(!!supabase);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState(null);
  const [renameId, setRenameId] = useState('');
  const [replaceId, setReplaceId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [uploadCategory, setUploadCategory] = useState(CATEGORIES[0].key);
  const [uploadSubject, setUploadSubject] = useState(SUBJECTS[0]);
  const [uploadChapter, setUploadChapter] = useState(chapterList.find(chapter => chapter.group === SUBJECTS[0])?.id || '');
  const fileInput = useRef(null);
  const replaceInput = useRef(null);
  const admin = !!auth.admin;
  const chapters = useMemo(() => ALL_FOLDERS.filter(chapter => folderSubject(chapter) === subject), [subject]);
  const selectedChapter = chapters.find(chapter => chapter.id === chapterId) || chapters[0];
  const uploadChapters = useMemo(() => ALL_FOLDERS.filter(chapter => folderSubject(chapter) === uploadSubject), [uploadSubject]);
  const currentDocuments = documents.filter(document => {
    const matched = rangesForChapter(document, subject, chapterId).length > 0 || (document.subject === subject && document.chapter_id === chapterId);
    return document.category === category && matched;
  }).filter(document => (document.display_name || document.file_name || '').toLowerCase().includes(search.toLowerCase()));

  async function refreshDocuments() {
    if (!supabase || !auth.real) { setDocuments([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('resource_documents').select('*').order('created_at', { ascending: false });
    if (error) setMessage(error.message || 'Resources could not be loaded. Apply the resource-library migrations in Supabase.');
    else setDocuments(data || []);
    setLoading(false);
  }

  useEffect(() => { refreshDocuments(); }, [auth.id, auth.real]);
  useEffect(() => {
    const firstChapter = ALL_FOLDERS.find(chapter => folderSubject(chapter) === subject);
    if (firstChapter) setChapterId(firstChapter.id);
  }, [subject]);
  useEffect(() => {
    const firstChapter = ALL_FOLDERS.find(chapter => folderSubject(chapter) === uploadSubject);
    if (firstChapter) setUploadChapter(firstChapter.id);
  }, [uploadSubject]);

  async function uploadFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || !supabase || !admin) return;
    setBusy(true); setMessage('');
    let uploaded = 0; let duplicates = 0;
    try {
      for (const file of files) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error(`${file.name} is not a PDF.`);
        const hash = await sha256(file);
        const { data: existing, error: lookupError } = await supabase.from('resource_documents').select('id').eq('sha256_hash', hash).maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) { duplicates += 1; continue; }
        const analysis = await inspectPdf(file, uploadSubject, uploadChapter);
        const path = [auth.id, uploadCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-'), uploadSubject.toLowerCase(), hash.slice(0, 16) + '-' + safeFileName(file.name)].join('/');
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', cacheControl: '300', upsert: false });
        if (uploadError) throw uploadError;
        const firstRange = analysis.chapterRanges[0];
        const record = {
          category: uploadCategory, subject: uploadSubject, chapter_id: firstRange?.chapterId || uploadChapter,
          chapter_name: firstRange?.chapterName || 'Science chapter', display_name: file.name, file_name: file.name,
          storage_path: path, mime_type: 'application/pdf', size_bytes: file.size, page_count: analysis.pageCount,
          chapter_pages: analysis.pages, chapter_ranges: analysis.chapterRanges, sha256_hash: hash,
          detected_chapters: analysis.detectedChapters, published: true, created_by: auth.id
        };
        const { error: rowError } = await supabase.from('resource_documents').insert(record);
        if (rowError) { await supabase.storage.from(BUCKET).remove([path]); throw rowError; }
        uploaded += 1;
      }
      await refreshDocuments();
      setMessage(`${uploaded} PDF${uploaded === 1 ? '' : 's'} uploaded${duplicates ? `; skipped ${duplicates} duplicate${duplicates === 1 ? '' : 's'}` : ''}.`);
    } catch (error) { setMessage(error.message || 'The PDF could not be uploaded.'); }
    finally { setBusy(false); }
  }

  async function openDocument(document) {
    setBusy(true); setMessage('');
    try {
      const ranges = rangesForChapter(document, subject, chapterId);
      const mappedPages = pagesFromRanges(ranges, document.page_count || 10000);
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(document.storage_path, 300);
      if (error) throw error;
      setViewer({ document, url: data.signedUrl, pages: mappedPages.length ? mappedPages : undefined, ranges });
    } catch (error) { setMessage(error.message || 'This PDF could not be opened.'); }
    finally { setBusy(false); }
  }

  async function saveName(event) {
    event.preventDefault();
    if (!renameId || !displayName.trim()) return;
    const { error } = await supabase.from('resource_documents').update({ display_name: displayName.trim() }).eq('id', renameId);
    if (error) { setMessage(error.message); return; }
    setDocuments(items => items.map(item => item.id === renameId ? { ...item, display_name: displayName.trim() } : item));
    setRenameId(''); setMessage('Resource name updated.');
  }

  async function deleteDocument(document) {
    if (!window.confirm(`Delete “${document.display_name || document.file_name}” from the resource library? This removes the stored PDF.`)) return;
    setBusy(true);
    try {
      const { error: fileError } = await supabase.storage.from(BUCKET).remove([document.storage_path]);
      if (fileError) throw fileError;
      const { error: rowError } = await supabase.from('resource_documents').delete().eq('id', document.id);
      if (rowError) throw rowError;
      setDocuments(items => items.filter(item => item.id !== document.id)); setMessage('Resource deleted.');
    } catch (error) { setMessage(error.message || 'The resource could not be deleted.'); }
    finally { setBusy(false); }
  }

  async function replaceFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    const document = documents.find(item => item.id === replaceId); setReplaceId('');
    if (!file || !document) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setMessage('Choose a PDF file.'); return; }
    setBusy(true);
    try {
      const [analysis, hash] = await Promise.all([inspectPdf(file, document.subject, document.chapter_id), sha256(file)]);
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(document.storage_path, file, { contentType: 'application/pdf', cacheControl: '300', upsert: true });
      if (uploadError) throw uploadError;
      const firstRange = analysis.chapterRanges[0];
      const { data, error } = await supabase.from('resource_documents').update({ display_name: file.name, file_name: file.name, size_bytes: file.size, page_count: analysis.pageCount, chapter_pages: analysis.pages, chapter_ranges: analysis.chapterRanges, sha256_hash: hash, detected_chapters: analysis.detectedChapters, chapter_id: firstRange?.chapterId || document.chapter_id, chapter_name: firstRange?.chapterName || document.chapter_name }).eq('id', document.id).select().single();
      if (error) throw error;
      setDocuments(items => items.map(item => item.id === document.id ? data : item)); setMessage('PDF replaced and its chapter pages rechecked.');
    } catch (error) { setMessage(error.message || 'The PDF could not be replaced.'); }
    finally { setBusy(false); }
  }

  if (viewer) return <PDFViewer file={viewer} onClose={() => setViewer(null)} />;

  return <div className="resource-page">
    <div className="page-heading"><div><span className="eyebrow">MURLIDHAR CLASSES · CLASS X SCIENCE</span><h1>Science Resource Library</h1><p>Open chapter material, short notes, important questions and NCERT Exemplar collections.</p></div></div>
    <div className="resource-categories" role="group" aria-label="Resource category">
      {CATEGORIES.map(item => <button key={item.key} className={category === item.key ? 'selected' : ''} onClick={() => setCategory(item.key)}><span className="resource-category-number">{item.number}</span><span className="resource-category-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="resource-category-count">{documents.filter(document => document.category === item.key).length}</span></button>)}
    </div>
    <div className="resource-subjects">{SUBJECTS.map((item, index) => {
      const count = documents.filter(document => document.category === category && documentRanges(document).some(range => range.subject === item)).length;
      return <button key={item} className={'card resource-subject' + (subject === item ? ' active' : '')} onClick={() => setSubject(item)}><span className={'resource-subject-icon tone-' + index}><FolderOpen size={19}/></span><span><strong>{item.toUpperCase()}</strong><small>{count} resource{count === 1 ? '' : 's'}</small></span><ArrowLeft size={15}/></button>;
    })}</div>
    <div className="resource-browser card">
      <div className="resource-browser-heading"><div><span className="eyebrow">{category}</span><h2>{subject} folders</h2></div><label className="search-box"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a document…"/></label></div>
      <div className="resource-folder-list">{chapters.map(chapter => {
        const count = documents.filter(document => document.category === category && rangesForChapter(document, subject, chapter.id).length > 0).length;
        return <button key={chapter.id} className={'resource-folder' + (chapterId === chapter.id ? ' active' : '')} onClick={() => setChapterId(chapter.id)}><Folder size={17}/><span>{chapter.name}</span><small>{count}</small></button>;
      })}</div>
      {selectedChapter && <div className="resource-documents">
        <div className="resource-documents-heading"><div><span className="eyebrow">{subject.toUpperCase()}</span><h3>{selectedChapter.name}</h3></div>{admin && <label className="secondary-button upload-button"><Upload size={15}/>{busy ? 'Processing…' : 'Upload PDFs'}<input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple onChange={uploadFiles} disabled={busy}/></label>}</div>
        {admin && <div className="resource-upload-settings">
          <label>Category<select value={uploadCategory} onChange={event => setUploadCategory(event.target.value)}>{CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
          <label>Subject<select value={uploadSubject} onChange={event => setUploadSubject(event.target.value)}>{SUBJECTS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Chapter<select value={uploadChapter} onChange={event => setUploadChapter(event.target.value)}>{uploadChapters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <p>Readable chapter headings are detected; scanned PDFs stay assigned to the selected folder. SHA-256 checks skip duplicate files.</p>
        </div>}
        {!supabase && <div className="resource-empty"><FileText size={20}/><strong>Connect Supabase to load resources</strong><span>Private document access requires the project configuration.</span></div>}
        {supabase && loading && <div className="resource-empty"><LoaderCircle size={20} className="spin"/><span>Loading resources…</span></div>}
        {supabase && !loading && currentDocuments.length === 0 && <div className="resource-empty"><FolderOpen size={20}/><strong>This folder is ready</strong><span>{admin ? 'Upload a PDF to publish it here.' : 'There are no published PDFs in this chapter folder yet.'}</span></div>}
        {currentDocuments.map(document => {
          const ranges = rangesForChapter(document, subject, chapterId);
          const pages = displayPageRanges(ranges);
          return <article className="resource-document" key={document.id}>
            <span className="resource-file-icon"><FileText size={18}/></span><div className="resource-file-meta"><strong>{document.display_name || document.file_name}</strong><span>{document.page_count || '—'} pages · {Math.max(1, Math.round((document.size_bytes || 0) / 1024))} KB</span><small>PDF pages {pages || '1–' + (document.page_count || '?')}</small></div>
            <button className="icon-button" title="Open in document viewer" onClick={() => openDocument(document)} disabled={busy}><Eye size={16}/></button>
            {admin && <><button className="icon-button" title="Rename resource" onClick={() => { setRenameId(document.id); setDisplayName(document.display_name || document.file_name); }}><Pencil size={15}/></button><button className="icon-button" title="Replace PDF" onClick={() => { setReplaceId(document.id); replaceInput.current?.click(); }}><Upload size={15}/></button><button className="icon-button resource-delete" title="Delete resource" onClick={() => deleteDocument(document)}><Trash2 size={15}/></button></>}
          </article>;
        })}
      </div>}
    </div>
    {admin && <><input ref={replaceInput} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={replaceFile}/>{renameId && <div className="modal-backdrop"><form className="modal stack-form" onSubmit={saveName}><button className="modal-close" type="button" onClick={() => setRenameId('')}><X size={18}/></button><span className="eyebrow">RESOURCE LIBRARY</span><h2>Rename document</h2><label>Document name<input value={displayName} onChange={event => setDisplayName(event.target.value)} required autoFocus/></label><button className="primary-button full">Save name</button></form></div>}</>}
    {message && <div className="resource-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={15}/></button></div>}
  </div>;
}

function PDFViewer({ file, onClose }) {
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(file.pages?.[0] || 1);
  const [pageCount, setPageCount] = useState(file.document.page_count || 1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [areaWidth, setAreaWidth] = useState(900);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef({ last: null, distance: 0, zoom: 1 });
  const lastTap = useRef({ time: 0, x: 0, y: 0 });

  const allowedPages = useMemo(() => {
    if (file.pages?.length) return file.pages;
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }, [file.pages, pageCount]);
  const pageIndex = Math.max(0, allowedPages.indexOf(pageNumber));

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjs.getDocument({ url: file.url, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: false });
    loadingTask.promise.then(document => {
      if (cancelled) { document.destroy(); return; }
      setPdf(document); setPageCount(document.numPages);
      setPageNumber(current => allowedPages.includes(current) ? current : (allowedPages[0] || 1));
      setLoading(false);
    }).catch(loadError => { if (!cancelled) { setError(loadError.message || 'PDF failed to load.'); setLoading(false); } });
    return () => { cancelled = true; loadingTask.destroy(); };
  }, [file.url]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => setAreaWidth(entries[0]?.contentRect.width || 900));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    const onEscape = event => { if (event.key === 'Escape' && isFullscreen && !document.fullscreenElement) setIsFullscreen(false); };
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('keydown', onEscape);
    return () => { document.removeEventListener('fullscreenchange', onFullscreen); document.removeEventListener('keydown', onEscape); };
  }, [isFullscreen]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return undefined;
    let renderTask; let cancelled = false;
    pdf.getPage(pageNumber).then(page => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const fitScale = Math.min(1.8, Math.max(0.2, (areaWidth - 32) / base.width));
      const viewport = page.getViewport({ scale: fitScale * zoom });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(18000000 / Math.max(1, viewport.width * viewport.height)));
      const canvas = canvasRef.current; const context = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      renderTask = page.render({ canvasContext: context, viewport });
      return renderTask.promise;
    }).catch(renderError => { if (!cancelled && renderError.name !== 'RenderingCancelledException') setError(renderError.message || 'Page preview failed.'); });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, pageNumber, zoom, areaWidth]);

  useEffect(() => { if (zoom <= 1) setPan({ x: 0, y: 0 }); }, [zoom]);

  function updateZoom(value) { setZoom(Math.max(0.7, Math.min(3.5, value))); }
  function stepPage(direction) { setPageNumber(allowedPages[Math.max(0, Math.min(allowedPages.length - 1, pageIndex + direction))] || 1); setPan({ x: 0, y: 0 }); }
  function setSectionPage(value) { const index = Math.max(0, Math.min(allowedPages.length - 1, Number(value) - 1)); setPageNumber(allowedPages[index] || 1); setPan({ x: 0, y: 0 }); }

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      gesture.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom, last: null };
    } else gesture.current.last = { x: event.clientX, y: event.clientY };
  }
  function handlePointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      setZoom(Math.max(0.7, Math.min(3.5, gesture.current.zoom * distance / (gesture.current.distance || distance))));
    } else if (zoom > 1 && gesture.current.last) {
      const previous = gesture.current.last;
      setPan(current => ({ x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }));
      gesture.current.last = { x: event.clientX, y: event.clientY };
    }
  }
  function handlePointerUp(event) {
    const multiTouch = pointers.current.size > 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.last = null;
    if (event.pointerType === 'touch' && !multiTouch) {
      const now = Date.now(); const previous = lastTap.current;
      if (now - previous.time < 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 28) {
        updateZoom(zoom > 1 ? 1 : 2); lastTap.current = { time: 0, x: 0, y: 0 };
      } else lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    }
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    if (isFullscreen) { setIsFullscreen(false); return; }
    try { await viewerRef.current?.requestFullscreen(); }
    catch { setIsFullscreen(true); }
  }

  return <div className="pdf-viewer" ref={viewerRef}>
    <header className="pdf-viewer-header"><button className="secondary-button" onClick={onClose}><ArrowLeft size={16}/> Resource folder</button><div className="pdf-viewer-title"><strong>{file.document.display_name || file.document.file_name}</strong><span>Section pages {file.ranges?.length ? displayPageRanges(file.ranges) : '1–' + pageCount}</span></div><button className="icon-button pdf-fullscreen" title={isFullscreen ? 'Exit full screen' : 'Full screen'} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>{isFullscreen ? <Minimize size={17}/> : <Maximize size={17}/>}</button></header>
    <div className="pdf-viewer-controls"><button className="icon-button" title="Previous page" disabled={pageIndex <= 0} onClick={() => stepPage(-1)}><ArrowLeft size={16}/></button><label className="pdf-page-picker">Section page <input aria-label="Section page number" type="number" min="1" max={allowedPages.length} value={pageIndex + 1} onChange={event => setSectionPage(event.target.value)}/> of {allowedPages.length}<small>PDF page {pageNumber}</small></label><button className="icon-button" title="Next page" disabled={pageIndex >= allowedPages.length - 1} onClick={() => stepPage(1)}><ArrowLeft className="rotate-180" size={16}/></button><span className="pdf-control-divider"/><button className="icon-button" title="Zoom out" onClick={() => updateZoom(zoom - 0.25)}><ZoomOut size={16}/></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" title="Zoom in" onClick={() => updateZoom(zoom + 0.25)}><ZoomIn size={16}/></button></div>
    <div className="pdf-canvas-area" ref={containerRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onDoubleClick={() => updateZoom(zoom > 1 ? 1 : 2)}>
      {loading && <div className="pdf-loading"><LoaderCircle className="spin" size={24}/> Opening document…</div>}
      {error && <div className="pdf-loading pdf-error">{error}</div>}
      <canvas ref={canvasRef} className="pdf-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }} aria-label={`PDF page ${pageNumber}`}/>
    </div>
  </div>;
}
