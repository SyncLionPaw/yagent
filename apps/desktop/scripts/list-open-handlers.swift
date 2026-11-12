import AppKit
import Foundation

/// 用法: list-open-handlers <fileOrDirPath>
/// 输出 JSON: { "default": "<appPath>"|null, "apps": [ { "path", "name", "icon" }, ... ], "systemIcons": {...} }
guard CommandLine.arguments.count >= 2 else {
  fputs("usage: list-open-handlers <path>\n", stderr)
  exit(2)
}

let filePath = CommandLine.arguments[1]
let fileURL = URL(fileURLWithPath: filePath)
var isDir: ObjCBool = false
guard FileManager.default.fileExists(atPath: filePath, isDirectory: &isDir) else {
  fputs("not found\n", stderr)
  exit(3)
}

let ws = NSWorkspace.shared
let defaultApp = ws.urlForApplication(toOpen: fileURL)
let apps = ws.urlsForApplications(toOpen: fileURL)

func displayName(for appURL: URL) -> String {
  if let bundle = Bundle(url: appURL) {
    if let n = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, !n.isEmpty {
      return n
    }
    if let n = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String, !n.isEmpty {
      return n
    }
  }
  return appURL.deletingPathExtension().lastPathComponent
}

func iconPNGBase64(for appURL: URL) -> String? {
  let src = ws.icon(forFile: appURL.path)
  // 压到 32×32 位图，避免高清模板图标撑到数 MB
  let size = NSSize(width: 32, height: 32)
  let out = NSImage(size: size)
  out.lockFocus()
  NSGraphicsContext.current?.imageInterpolation = .high
  src.draw(
    in: NSRect(origin: .zero, size: size),
    from: NSRect(origin: .zero, size: src.size),
    operation: .copy,
    fraction: 1.0,
  )
  out.unlockFocus()
  guard let tiff = out.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
  else { return nil }
  return png.base64EncodedString()
}

var seen = Set<String>()
var list: [[String: Any]] = []
func appendApp(_ appURL: URL) {
  let p = appURL.path
  guard seen.insert(p).inserted else { return }
  var item: [String: Any] = [
    "path": p,
    "name": displayName(for: appURL),
  ]
  if let icon = iconPNGBase64(for: appURL) {
    item["icon"] = icon
  }
  list.append(item)
}

/** 默认优先；再优先补常见编辑器，最后填其它，总共最多 3 个 */
let preferredNames: Set<String> = [
  "Visual Studio Code",
  "Code",
  "Cursor",
  "Sublime Text",
  "Zed",
  "Nova",
  "BBEdit",
]
if let d = defaultApp {
  appendApp(d)
}
for app in apps where preferredNames.contains(displayName(for: app)) {
  appendApp(app)
  if list.count >= 3 { break }
}
if list.count < 3 {
  for app in apps {
    appendApp(app)
    if list.count >= 3 { break }
  }
}

/** 菜单底部「访达 / 终端」两项的系统图标 */
func systemIcon(path: String) -> String? {
  guard FileManager.default.fileExists(atPath: path) else { return nil }
  return iconPNGBase64(for: URL(fileURLWithPath: path))
}

var systemIcons: [String: String] = [:]
let finderCandidates = [
  "/System/Library/CoreServices/Finder.app",
]
let terminalCandidates = [
  "/System/Applications/Utilities/Terminal.app",
  "/Applications/Utilities/Terminal.app",
]
for p in finderCandidates {
  if let icon = systemIcon(path: p) {
    systemIcons["reveal"] = icon
    break
  }
}
for p in terminalCandidates {
  if let icon = systemIcon(path: p) {
    systemIcons["terminal"] = icon
    break
  }
}

let payload: [String: Any] = [
  "default": defaultApp?.path as Any,
  "apps": list,
  "systemIcons": systemIcons,
  "isDir": isDir.boolValue,
]
if let data = try? JSONSerialization.data(withJSONObject: payload),
   let text = String(data: data, encoding: .utf8) {
  print(text)
} else {
  fputs("encode failed\n", stderr)
  exit(4)
}
