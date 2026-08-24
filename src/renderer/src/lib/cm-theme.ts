import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'

// Colours come straight from the app's CSS variables, so a single theme adapts to
// the `.dark` class automatically — same tokens the static YamlPane used. Shared by
// the YAML editor and the ConfigMap/Secret value editor.
export function lightshipCmTheme(dark: boolean) {
  return createTheme({
    theme: dark ? 'dark' : 'light',
    settings: {
      background: 'rgb(var(--background))',
      foreground: 'rgb(var(--muted-foreground))',
      caret: 'rgb(var(--primary))',
      selection: 'rgb(var(--accent))',
      selectionMatch: 'rgb(var(--accent))',
      lineHighlight: 'transparent',
      gutterBackground: 'rgb(var(--background))',
      gutterForeground: 'rgb(var(--faint))',
      gutterBorder: 'transparent',
      fontFamily: '"JetBrains Mono Variable", ui-monospace, "SFMono-Regular", monospace'
    },
    styles: [
      { tag: [t.propertyName, t.definition(t.propertyName)], color: 'rgb(var(--info))' },
      { tag: [t.string, t.bool, t.atom], color: 'rgb(var(--success))' },
      { tag: [t.number], color: 'rgb(var(--t-700))' },
      { tag: [t.comment], color: 'rgb(var(--faint))', fontStyle: 'italic' },
      { tag: [t.separator, t.punctuation], color: 'rgb(var(--dim))' }
    ]
  })
}
