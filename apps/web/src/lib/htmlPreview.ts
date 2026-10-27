/**
 * HTML 预览用 iframe sandbox：
 * - allow-scripts：流程图 / mermaid / 内联 JS 能画出来（空 sandbox 会整页空白）
 * - 不加 allow-same-origin：避免 srcDoc 继承父页源后脚本读到应用 DOM
 */
export const HTML_PREVIEW_SANDBOX = 'allow-scripts'

/** 给相对 CSS/图片补 base（项目文件预览）；已有 <base> 则不改 */
export function htmlWithBase(html: string, baseHref?: string): string {
  if (!baseHref || /<base\s/i.test(html)) return html
  const tag = `<base href="${baseHref.replace(/"/g, '&quot;')}">`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`)
  return `<!DOCTYPE html><head>${tag}</head>${html}`
}
