declare module "qrcode-terminal" {
  interface QRCodeTerminal {
    generate(text: string, options?: { small?: boolean }): void;
  }
  const qr: QRCodeTerminal;
  export default qr;
}
