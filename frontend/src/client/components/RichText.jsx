import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { usePrompt } from '../ui.jsx';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Text saved before the editor existed (no tags) as paragraphs, so its line breaks survive. */
export const asHtml = (v) =>
  !v?.trim() || /<[a-z][^>]*>/i.test(v)
    ? v ?? ''
    : v
        .trim()
        .split(/\n\s*\n/)
        .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');

// Simple rich text for instructions: bold, italic, lists and clickable links. The API keeps only
// those tags (sanitize-html), so whatever is pasted, only safe HTML is stored and emailed.
export function RichText({ value, onChange, placeholder = '', id }) {
  const prompt = usePrompt();
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } })],
    content: value || '',
    editorProps: {
      attributes: {
        id,
        class: 'rich tiptap min-h-24 px-3 py-2 text-[15px]',
        'data-placeholder': placeholder,
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  });
  useEffect(() => {
    if (editor && !editor.isFocused && (value || '') !== (editor.isEmpty ? '' : editor.getHTML())) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  const btn = (label, active, run, title) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`cursor-pointer rounded px-2 py-1 text-sm ${active ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-sunken'}`}>
      {label}
    </button>
  );
  const link = async () => {
    const prev = editor.getAttributes('link').href ?? '';
    const href = await prompt({
      title: prev ? 'Edit link' : 'Add a link',
      label: 'Link address',
      hint: prev ? 'Leave it empty to remove the link.' : 'A web address, mailto: or tel:. Select some text first to link it.',
      placeholder: 'https://…',
      value: prev,
      action: prev ? 'Save link' : 'Add link',
      required: false,
    });
    if (href === null) return;
    if (!href) return editor.chain().focus().unsetLink().run();
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="overflow-hidden rounded-btn border border-line-strong bg-surface focus-within:border-brand">
      {editor && (
        <div className="flex flex-wrap gap-0.5 border-b border-line bg-sunken/60 px-1.5 py-1">
          {btn(<b>B</b>, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold')}
          {btn(<i>I</i>, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic')}
          {btn('• List', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'Bulleted list')}
          {btn('1. List', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list')}
          {btn('Link', editor.isActive('link'), link, 'Add a link')}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
