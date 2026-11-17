import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Button, Divider, Radio, Spin, Tooltip } from 'antd';
import { BoldOutlined, CodeOutlined, FontSizeOutlined, ItalicOutlined, LinkOutlined, MessageOutlined, PictureOutlined, UnorderedListOutlined } from '@ant-design/icons';
import './editor-theme.css';

const sourceTools = [
  ['二级标题', FontSizeOutlined, '## ', '', true],
  ['加粗', BoldOutlined, '**', '**'],
  ['斜体', ItalicOutlined, '*', '*'],
  ['引用', MessageOutlined, '> ', '', true],
  ['无序列表', UnorderedListOutlined, '- ', '', true],
  ['链接', LinkOutlined, '[', '](https://)'],
  ['行内代码', CodeOutlined, '`', '`'],
];
export const getMarkdownValue = host => host?.querySelector('textarea')?.value ?? '';

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
      : content.value !== value && <div className="service-preview-status" role="status"><Spin size="small" /> 正在更新预览…</div>}
    <div className="prose service-preview-body" dangerouslySetInnerHTML={{ __html: content.html }} />
  </div>;
}

export default forwardRef(function MarkdownEditor({ value, readOnly, previewOnly, active, onPreview, onChange, onSave, onUploadImages, renderPreview }, ref) {
  const source = useRef(null);
  const image = useRef(null);
  const imageSelection = useRef(null);
  const markdown = useRef(value);
  markdown.current = value;
  const latest = useRef();
  latest.current = { readOnly, previewOnly, onChange };
  function replace(from, to, text, selection = [from + text.length, from + text.length]) {
    const next = markdown.current.slice(0, from) + text + markdown.current.slice(to);
    markdown.current = next;
    latest.current.onChange(next);
    requestAnimationFrame(() => { source.current?.focus(); source.current?.setSelectionRange(...selection); });
  }
  useImperativeHandle(ref, () => ({
    getValue: () => markdown.current,
    focus() { if (!latest.current.previewOnly) { source.current?.focus(); source.current?.setSelectionRange(markdown.current.length, markdown.current.length); } },
    insert(text) {
      if (latest.current.readOnly && !imageSelection.current || latest.current.previewOnly || !source.current) return false;
      const selection = imageSelection.current || { from: source.current.selectionStart, to: source.current.selectionEnd };
      replace(selection.from, selection.to, text);
      return true;
    },
  }), []);
  function formatSource(prefix, suffix, wholeLines) {
    const input = source.current;
    if (!input || readOnly) return;
    let from = input.selectionStart;
    const to = input.selectionEnd;
    if (wholeLines) {
      from = markdown.current.lastIndexOf('\n', from - 1) + 1;
      const text = markdown.current.slice(from, to);
      const inserted = text.replace(/^/gm, (_match, offset) => offset === text.length && offset > 0 ? '' : prefix);
      replace(from, to, inserted);
    } else {
      const text = markdown.current.slice(from, to);
      replace(from, to, prefix + text + suffix, [from + prefix.length, to + prefix.length]);
    }
  }
  async function uploadSourceImages(event) {
    const files = Array.from(event.target.files);
    event.target.value = '';
    imageSelection.current = { from: source.current.selectionStart, to: source.current.selectionEnd };
    try { await onUploadImages(files); }
    finally { imageSelection.current = null; }
  }
  return <div id="knowledge-markdown" className="knowledge-markdown-editor" data-mode={previewOnly ? 'preview' : 'source'} onKeyDown={event => {
    if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!readOnly) onSave?.(); }
  }}>
    <div className="knowledge-editor-toolbar">
      <input ref={image} id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden disabled={readOnly} onChange={uploadSourceImages} />
      <div className="editor-format-actions" hidden={previewOnly}>
        {sourceTools.map(([label, Icon, ...format]) => <Tooltip key={label} title={label} open={active && !readOnly ? undefined : false}>
          <Button htmlType="button" type="text" size="small" icon={<Icon />} aria-label={label} disabled={readOnly} onClick={() => formatSource(...format)} />
        </Tooltip>)}
        <Divider type="vertical" />
        <Tooltip title="插入图片" open={active && !readOnly ? undefined : false}>
          <Button id="upload-image" htmlType="button" type="text" size="small" icon={<PictureOutlined />} aria-label="插入图片" disabled={readOnly} onClick={() => image.current?.click()} />
        </Tooltip>
      </div>
      <Radio.Group className="editor-mode-actions" aria-label="正文模式" size="small" disabled={readOnly} value={previewOnly ? 'preview' : 'source'} onChange={event => onPreview(event.target.value === 'preview')}>
        <Radio.Button value="source">源码</Radio.Button><Radio.Button value="preview">预览</Radio.Button>
      </Radio.Group>
    </div>
    <textarea ref={source} id="markdown-source" name="markdown" className="markdown-source" hidden={previewOnly} readOnly={readOnly} value={value} aria-describedby="editor-help" spellCheck={false}
      onChange={event => { markdown.current = event.target.value; onChange(event.target.value); }} />
    <Preview value={value} active={active && previewOnly} renderPreview={renderPreview} />
  </div>;
});
