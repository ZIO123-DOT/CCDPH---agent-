# macOS 正式发布配置

CCDPH 的 macOS DMG 必须使用 Apple Developer Program 提供的 **Developer ID Application** 证书签名，并通过 Apple 公证。ad-hoc 签名只能用于本机开发测试，不能解决 GitHub 下载文件的 Gatekeeper 拦截。

## GitHub Actions Secrets

在仓库 `Settings → Secrets and variables → Actions` 中配置：

- `MACOS_CERTIFICATE`：导出的 Developer ID Application `.p12` 文件的 Base64 内容。
- `MACOS_CERTIFICATE_PASSWORD`：导出 `.p12` 时设置的密码。
- `APPLE_ID`：Apple Developer 账号邮箱。
- `APPLE_APP_SPECIFIC_PASSWORD`：在 Apple ID 账号页创建的 app-specific password。
- `APPLE_TEAM_ID`：Apple Developer Team ID。

生成 `MACOS_CERTIFICATE` 的示例：

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

不要把证书、密码或 Apple ID 凭据写入仓库文件。发布工作流在任何凭据缺失时都会中止 macOS 构建。

## 发布验证

推送 `v*` 标签后，macOS 构建会自动执行：

1. electron-builder 导入证书并用 Developer ID Application 签名。
2. `@electron/notarize` 调用 Apple notarytool 公证并装订票据。
3. `codesign --verify --deep --strict` 检查签名完整性。
4. `xcrun stapler validate` 检查公证票据。
5. `spctl --assess --type execute` 验证 Gatekeeper 接受应用。
6. `hdiutil verify` 验证最终 DMG 完整性。

只有以上步骤全部成功，Release job 才会上传 DMG。
