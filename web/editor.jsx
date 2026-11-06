import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MDXEditor, headingsPlugin, listsPlugin, quotePlugin, linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin, thematicBreakPlugin, markdownShortcutPlugin, codeBlockPlugin, codeMirrorPlugin, diffSourcePlugin, toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, CreateLink, InsertImage, InsertTable, InsertCodeBlock, Separator, realmPlugin, markdownSourceEditorValue$, viewMode$ } from '@mdxeditor/editor';
import { Alert, Button, Divider, Radio, Spin, Tooltip } from 'antd';
import { BoldOutlined, CodeOutlined, FontSizeOutlined, ItalicOutlined, LinkOutlined, MessageOutlined, PictureOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { EditorView } from '@codemirror/view';
import '@mdxeditor/editor/style.css';
import './editor-theme.css';

const styleNonce = document.querySelector('meta[name="style-nonce"]')?.content;
if (styleNonce) globalThis.__webpack_nonce__ = styleNonce;
const translations = { 'Bold': '加粗', 'Italic': '斜体', 'Underline': '下划线', 'Undo': '撤销', 'Redo': '重做', 'Insert image': '插入图片', 'Insert table': '插入表格', 'Insert code block': '代码块' };
const connectView = realmPlugin({
  postInit(realm, { connect, initialMarkdown }) {
    connect(realm);
    // Seed CodeMirror directly. Lexical imports the draft only in visual mode.
    realm.pub(markdownSourceEditorValue$, initialMarkdown);
  },
});
const sourceTools = [
  ['二级标题', FontSizeOutlined, '## ', '', true],
  ['加粗', BoldOutlined, '**', '**'],
  ['斜体', ItalicOutlined, '*', '*'],
  ['引用', MessageOutlined, '> ', '', true],
  ['无序列表', UnorderedListOutlined, '- ', '', true],
  ['链接', LinkOutlined, '[', '](https://)'],
  ['行内代码', CodeOutlined, '`', '`'],
];
const editors = new WeakMap();
export const getMarkdownValue = host => editors.get(host)?.getMarkdown() ?? '';
function Preview({ value, active, renderPreview }) {
  const [content, setContent] = useState({ html: '', value: null, error: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try { const html = await renderPreview(value, abort.signal); if (!abort.signal.aborted) setContent({ html, value, error: false }); }
      catch { if (!abort.signal.aborted) setContent(old => ({ ...old, error: true })); }
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [value, active, renderPreview, retry]);
  return <div id="knowledge-markdown-preview" className="service-preview" aria-label="正文预览" hidden={!active} aria-busy={active && content.value !== value && !content.error}>
    {content.error ? <Alert className="service-preview-status" type="warning" title="预览暂时未更新，正文仍保留。"
      action={<Button size="small" onClick={() => setRetry(n => n + 1)}>重新生成预览</Button>} />
      : content.value !== value && <div className="service-preview-status" role="status">
        <Spin size="small" /> 正在更新预览…
      </div>}
    <div className="prose service-preview-body" dangerouslySetInnerHTML={{ __html: content.html }} />
  </div>;
}

// Keep the existing workspace contract; session keys reset editor history between cards.
export default forwardRef(function MarkdownEditor({ value, readOnly, previewOnly, active, onPreview, onChange, onSave, onUploadImages, onError, renderPreview }, ref) {
  const editor = useRef(null);
  const host = useRef(null);
  const image = useRef(null);
  const imageSelection = useRef(null);
  const realm = useRef(null);
  const markdown = useRef(value);
  const switching = useRef(false);
  const [mode, setMode] = useState('source');
  const [imageUploading, setImageUploading] = useState(false);
  const latest = useRef();
  latest.current = { previewOnly, mode, onUploadImages };
  const extensions = useMemo(() => styleNonce ? [EditorView.cspNonce.of(styleNonce)] : [], []);
  const sourceExtensions = useMemo(() => [...extensions, EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码', spellcheck: 'false' })], [extensions]);
  const sourceView = () => {
    const node = host.current?.querySelector('.mdxeditor-source-editor .cm-editor');
    return node && EditorView.findFromDOM(node);
  };
  useEffect(() => {
    const node = host.current;
    editors.set(node, { getMarkdown: () => markdown.current });
    return () => editors.delete(node);
  }, []);
  useImperativeHandle(ref, () => ({
    getValue: () => markdown.current,
    focus() {
      if (latest.current.previewOnly) return;
      if (latest.current.mode === 'source') sourceView()?.focus();
      else editor.current?.focus();
    },
    insert(text) {
      if (latest.current.previewOnly || !editor.current) return false;
      const selection = imageSelection.current;
      const view = selection && sourceView();
      if (view) {
        const { from, to } = selection;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      } else {
        editor.current.insertMarkdown(text);
      }
      return true;
    },
  }), []);
  function changeMode(next) {
    if (next !== mode) {
      const draft = markdown.current;
      switching.current = true;
      try {
        realm.current.pub(viewMode$, next);
        // Preserve the draft when merely inspecting it in another mode.
        if (next === 'source') editor.current.setMarkdown(draft);
      } finally { switching.current = false; }
      setMode(next);
    }
    onPreview(false);
  }
  function formatSource(prefix, suffix, wholeLines) {
    const view = sourceView();
    if (!view || view.state.readOnly) return;
    const { from, to } = view.state.selection.main;
    if (wholeLines) {
      const start = view.state.doc.lineAt(from).from;
      const text = view.state.sliceDoc(start, to);
      const insert = text.replace(/^/gm, (_match, offset) => offset === text.length && offset > 0 ? '' : prefix);
      view.dispatch({ changes: { from: start, to, insert }, selection: { anchor: to + insert.length - text.length } });
    } else {
      const text = view.state.sliceDoc(from, to);
      view.dispatch({ changes: { from, to, insert: prefix + text + suffix }, selection: { anchor: from + prefix.length, head: to + prefix.length } });
    }
    view.focus();
  }
  async function uploadSourceImages(event) {
    const files = Array.from(event.target.files);
    event.target.value = '';
    // Locking the editor during upload can recreate the CodeMirror view.
    imageSelection.current = sourceView()?.state.selection.main ?? null;
    try { await onUploadImages(files); }
    finally { imageSelection.current = null; }
  }
  const upload = async file => {
    // MDXEditor cancels in-flight uploads when its readOnly cell changes.
    // Keep Lexical editable internally; inert and the workspace lock block user actions.
    flushSync(() => setImageUploading(true));
    try {
      const paths = await latest.current.onUploadImages([file], { insert: false });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!paths?.[0]) throw new Error('图片上传未完成，正文仍保留。');
      return paths[0];
    } finally { flushSync(() => setImageUploading(false)); }
  };
  return <div ref={host} id="knowledge-markdown" className="knowledge-mdx-editor" data-mode={previewOnly ? 'preview' : mode} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!readOnly) onSave?.(); } }}>
    <div className="knowledge-editor-input" inert={imageUploading}>
      <MDXEditor ref={editor} markdown="" readOnly={readOnly && !imageUploading} trim={false} contentEditableClassName="prose knowledge-contenteditable" className="knowledge-mdx" spellCheck={false}
        translation={(_key, defaultValue, variables = {}) => (translations[defaultValue] ?? defaultValue).replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '')}
        onChange={(next, initial) => { if (initial || switching.current || next === markdown.current) return; markdown.current = next; onChange(next); }}
        onError={() => { if (realm.current?.getValue(viewMode$) === 'rich-text') onError('部分 Markdown 无法在可视化模式编辑。切回源码可继续编辑原文。'); }}
        plugins={[
          headingsPlugin(), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin(), tablePlugin(), thematicBreakPlugin(), markdownShortcutPlugin(),
          imagePlugin({ imageUploadHandler: upload }), codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
          codeMirrorPlugin({ codeBlockLanguages: { text: '纯文本', js: 'JavaScript', ts: 'TypeScript', json: 'JSON', css: 'CSS', html: 'HTML', bash: 'Shell', python: 'Python' }, codeMirrorExtensions: extensions, autoLoadLanguageSupport: false }),
          diffSourcePlugin({ viewMode: 'source', codeMirrorExtensions: sourceExtensions }),
          connectView({ initialMarkdown: markdown.current, connect: next => { realm.current = next; } }),
          toolbarPlugin({ toolbarClassName: 'knowledge-editor-toolbar', toolbarContents: () => <>
            <input ref={image} id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={uploadSourceImages} />
            <div className="editor-format-actions" hidden={previewOnly}>
              {mode === 'source' ? <>
                {sourceTools.map(([label, Icon, ...format]) => <Tooltip key={label} title={label} open={active && !readOnly ? undefined : false}>
                  <Button type="text" size="small" icon={<Icon />} aria-label={label} disabled={readOnly}
                    onClick={() => formatSource(...format)} />
                </Tooltip>)}
                <Divider type="vertical" />
                <Tooltip title="插入图片" open={active && !readOnly ? undefined : false}>
                  <Button id="upload-image" type="text" size="small" icon={<PictureOutlined />} aria-label="插入图片"
                    disabled={readOnly} onClick={() => image.current?.click()} />
                </Tooltip>
              </> : <><UndoRedo /><Separator /><BlockTypeSelect /><BoldItalicUnderlineToggles /><ListsToggle /><CreateLink /><InsertImage /><InsertTable /><InsertCodeBlock /></>}
            </div>
            <Radio.Group className="editor-mode-actions" aria-label="正文模式" size="small" disabled={readOnly}
              value={previewOnly ? 'preview' : mode} onChange={event => {
                const next = event.target.value;
                if (next === 'preview') onPreview(true);
                else changeMode(next);
              }}>
              <Radio.Button value="source">源码</Radio.Button>
              <Radio.Button value="rich-text">可视化</Radio.Button>
              <Radio.Button value="preview">预览</Radio.Button>
            </Radio.Group>
          </> }),
        ]} />
    </div>
    <Preview value={value} active={active && previewOnly} renderPreview={renderPreview} />
  </div>;
});
