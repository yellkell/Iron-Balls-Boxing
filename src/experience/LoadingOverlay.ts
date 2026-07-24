import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type PerspectiveCamera,
} from 'three';

/**
 * A tiny head-locked transition card. DOM content is not visible inside an
 * immersive WebXR session, so the club loader has to live in the 3D view.
 */
export class LoadingOverlay {
  private readonly root = new Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;

  constructor(camera: PerspectiveCamera) {
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;

    const shade = new Mesh(
      new PlaneGeometry(4.8, 3),
      new MeshBasicMaterial({
        color: 0x07080b,
        depthTest: false,
        depthWrite: false,
      }),
    );
    shade.position.z = -1.7;
    shade.renderOrder = 10_000;

    const card = new Mesh(
      new PlaneGeometry(1.8, 0.9),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    card.position.z = -1.65;
    card.renderOrder = 10_001;

    this.root.add(shade, card);
    this.root.visible = false;
    camera.add(this.root);
    this.setText('OPENING THE CLUB', 'Hold tight');
  }

  show(title: string, detail: string): void {
    this.setText(title, detail);
    this.root.visible = true;
  }

  update(title: string, detail: string): void {
    this.setText(title, detail);
  }

  hide(): void {
    this.root.visible = false;
  }

  private setText(title: string, detail: string): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);

    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgba(19,22,29,0.98)');
    gradient.addColorStop(1, 'rgba(7,8,11,0.98)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#ff7a18';
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, w - 36, h - 36);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffb000';
    ctx.shadowColor = '#ff5a18';
    ctx.shadowBlur = 24;
    ctx.font = "900 72px 'Arial Black', system-ui, sans-serif";
    ctx.fillText(title, w / 2, h * 0.43);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d7dde7';
    ctx.font = "700 36px system-ui, sans-serif";
    ctx.fillText(detail, w / 2, h * 0.67);
    this.texture.needsUpdate = true;
  }
}
