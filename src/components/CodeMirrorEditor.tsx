import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

interface CodeMirrorEditorProps {
  value: string;
  language: string;
  onChange: (val: string) => void;
}

export default function CodeMirrorEditor({ value, language, onChange }: CodeMirrorEditorProps) {
  const extensions = useMemo(() => {
    const lang = language.toLowerCase();
    if (lang === 'html' || lang === 'htm' || lang === 'svg') return [html()];
    if (lang === 'css') return [css()];
    if (lang === 'markdown' || lang === 'md') return [markdown()];
    return [javascript({ jsx: true, typescript: true })];
  }, [language]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={oneDark}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: true,
      }}
      className="h-full text-[13px]"
    />
  );
}
