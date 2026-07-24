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
  private readonly logo = new Image();
  private title = 'OPENING THE CLUB';
  private detail = 'Hold tight';
  private phase = 0;

  constructor(camera: PerspectiveCamera) {
    this.canvas.width = 1280;
    this.canvas.height = 640;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.logo.decoding = 'async';
    this.logo.onload = () => this.draw();
    this.logo.src = '/signs/fire-fight.png';

    const shade = new Mesh(
      // Oversized on purpose: cover the complete per-eye XR frustum so no
      // sliver of the outgoing room survives in peripheral vision.
      new PlaneGeometry(20, 20),
      new MeshBasicMaterial({
        color: 0x030406,
        depthTest: false,
        depthWrite: false,
      }),
    );
    shade.position.z = -1.7;
    shade.renderOrder = 10_000;

    const card = new Mesh(
      new PlaneGeometry(2.08, 1.04),
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
    this.draw();
  }

  show(title: string, detail: string): void {
    this.title = title;
    this.detail = detail;
    this.phase = 0;
    this.draw();
    this.root.visible = true;
  }

  update(title: string, detail: string): void {
    this.title = title;
    this.detail = detail;
    // Advance on real loading milestones instead of uploading a large canvas
    // texture every frame; the screen stays lively without taxing Quest.
    this.phase = (this.phase + 4) % 12;
    this.draw();
  }

  hide(): void {
    this.root.visible = false;
  }

  private chamferedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    cut: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + width - cut, y);
    ctx.lineTo(x + width, y + cut);
    ctx.lineTo(x + width, y + height - cut);
    ctx.lineTo(x + width - cut, y + height);
    ctx.lineTo(x + cut, y + height);
    ctx.lineTo(x, y + height - cut);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
  }

  private fitTitle(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): void {
    let size = 62;
    do {
      ctx.font = `900 ${size}px 'Arial Black', system-ui, sans-serif`;
      size -= 2;
    } while (size > 38 && ctx.measureText(text).width > maxWidth);
  }

  private drawLogo(ctx: CanvasRenderingContext2D): void {
    const x = 72;
    const y = 120;
    const width = 330;
    const height = 300;
    this.chamferedRect(ctx, x, y, width, height, 20);
    ctx.save();
    ctx.clip();

    if (this.logo.complete && this.logo.naturalWidth > 0) {
      // The committed sign includes a large atmospheric border. Crop into the
      // handmade neon lettering so it reads as a mark, not a picture-in-picture.
      const sx = this.logo.naturalWidth * 0.25;
      const sy = this.logo.naturalHeight * 0.08;
      const sw = this.logo.naturalWidth * 0.5;
      const sh = this.logo.naturalHeight * 0.72;
      ctx.drawImage(this.logo, sx, sy, sw, sh, x, y, width, height);
      const vignette = ctx.createRadialGradient(x + width / 2, y + height / 2, 40, x + width / 2, y + height / 2, 230);
      vignette.addColorStop(0, 'rgba(3,4,6,0)');
      vignette.addColorStop(0.72, 'rgba(3,4,6,0.18)');
      vignette.addColorStop(1, 'rgba(3,4,6,0.82)');
      ctx.fillStyle = vignette;
      ctx.fillRect(x, y, width, height);
    } else {
      const glow = ctx.createRadialGradient(x + width / 2, y + height / 2, 10, x + width / 2, y + height / 2, 170);
      glow.addColorStop(0, 'rgba(255,59,32,0.48)');
      glow.addColorStop(1, 'rgba(255,59,32,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = '#ffe0b0';
      ctx.font = "900 118px 'Arial Black', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('FF', x + width / 2, y + height * 0.62);
    }
    ctx.restore();

    this.chamferedRect(ctx, x, y, width, height, 20);
    ctx.strokeStyle = 'rgba(255,122,24,0.44)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);

    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#14171d');
    gradient.addColorStop(0.56, '#0b0d12');
    gradient.addColorStop(1, '#07080b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const emberWash = ctx.createRadialGradient(250, 270, 10, 250, 270, 430);
    emberWash.addColorStop(0, 'rgba(255,45,18,0.22)');
    emberWash.addColorStop(0.55, 'rgba(255,70,20,0.08)');
    emberWash.addColorStop(1, 'rgba(255,70,20,0)');
    ctx.fillStyle = emberWash;
    ctx.fillRect(0, 0, w, h);

    this.chamferedRect(ctx, 18, 18, w - 36, h - 36, 28);
    ctx.strokeStyle = 'rgba(255,122,24,0.7)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#ff7a18';
    ctx.fillRect(44, 42, 92, 5);
    ctx.fillStyle = 'rgba(215,221,231,0.68)';
    ctx.font = "700 19px system-ui, sans-serif";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('FIRE FIGHT  /  TRANSIT', 154, 45);

    this.drawLogo(ctx);

    ctx.strokeStyle = 'rgba(153,163,178,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(438, 112);
    ctx.lineTo(438, 438);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,122,24,0.72)';
    ctx.font = "800 20px system-ui, sans-serif";
    ctx.fillText('DESTINATION CHANGE', 486, 158);

    this.fitTitle(ctx, this.title, 690);
    ctx.fillStyle = '#f4f6fa';
    ctx.shadowColor = 'rgba(255,74,24,0.72)';
    ctx.shadowBlur = 18;
    ctx.fillText(this.title, 486, 252);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aeb6c2';
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText(this.detail, 486, 326);

    const barX = 486;
    const barY = 390;
    const segmentWidth = 47;
    const gap = 9;
    for (let i = 0; i < 12; i++) {
      const distance = (i - this.phase + 12) % 12;
      const hot = distance === 0;
      const warm = distance === 11 || distance === 1;
      ctx.fillStyle = hot ? '#ffb000' : warm ? '#ff6a18' : 'rgba(105,116,132,0.24)';
      ctx.shadowColor = hot ? '#ff4a18' : 'transparent';
      ctx.shadowBlur = hot ? 14 : 0;
      this.chamferedRect(ctx, barX + i * (segmentWidth + gap), barY, segmentWidth, 11, 3);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(215,221,231,0.48)';
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText('SAME SESSION  •  NEW ROOM', 486, 454);

    ctx.fillStyle = 'rgba(255,122,24,0.65)';
    ctx.fillRect(44, h - 70, w - 88, 2);
    ctx.fillStyle = 'rgba(174,182,194,0.46)';
    ctx.font = "600 17px system-ui, sans-serif";
    ctx.fillText('KEEP YOUR HEADSET ON', 44, h - 43);
    ctx.textAlign = 'right';
    ctx.fillText('IRON BALLS BOXING', w - 44, h - 43);

    this.texture.needsUpdate = true;
  }
}
