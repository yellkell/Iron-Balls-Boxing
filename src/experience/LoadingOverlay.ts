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
  /** 0..1, advanced by update() on real loading milestones. */
  private progress = 0;
  /** Where we are going — the card's headline. */
  private destination = 'THE CLUB';
  private strap = '';

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

  /**
   * `destination` is the headline — this card is shown travelling BOTH ways, so
   * saying where you are going beats a bare "LOADING" that could mean either.
   */
  show(destination: string, strap = ''): void {
    this.progress = 0;
    this.destination = destination;
    this.strap = strap;
    this.draw();
    this.root.visible = true;
  }

  update(): void {
    // Advance on real loading milestones instead of uploading a large canvas
    // texture every frame; the screen stays lively without taxing Quest.
    //
    // Each milestone closes part of the REMAINING gap rather than stepping a
    // fixed amount, so the bar always moves forward and never overruns however
    // many milestones a given transition happens to report — and it is honest
    // progress rather than the old 12-segment chase, which with only two or
    // three update() calls per transition never read as motion anyway (and
    // wrapped, leaving a stray lit segment stranded at the far end).
    this.progress += (1 - this.progress) * 0.45;
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

  /** The FIRE FIGHT neon sign, centred as a MARK — not boxed and vignetted
   *  into a little framed thumbnail, which read as a picture-in-picture. */
  private drawMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number): void {
    if (this.logo.complete && this.logo.naturalWidth > 0) {
      // Crop into the handmade neon lettering; the committed sign carries a
      // large atmospheric border around it.
      const sx = this.logo.naturalWidth * 0.25;
      const sy = this.logo.naturalHeight * 0.08;
      const sw = this.logo.naturalWidth * 0.5;
      const sh = this.logo.naturalHeight * 0.72;
      const height = (width * sh) / sw;
      ctx.drawImage(this.logo, sx, sy, sw, sh, cx - width / 2, cy - height / 2, width, height);
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe0b0';
      ctx.shadowColor = 'rgba(255,74,24,0.8)';
      ctx.shadowBlur = 20;
      ctx.font = "900 62px 'Arial Black', system-ui, sans-serif";
      ctx.fillText('FIRE FIGHT', cx, cy);
      ctx.shadowBlur = 0;
    }
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const cx = w / 2;
    ctx.clearRect(0, 0, w, h);

    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#14171d');
    gradient.addColorStop(0.56, '#0b0d12');
    gradient.addColorStop(1, '#07080b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // The ember wash sits under the middle of the card now, with the content —
    // parked off in the top-left corner it lit an empty quarter of the screen.
    const emberWash = ctx.createRadialGradient(cx, h * 0.46, 10, cx, h * 0.46, 520);
    emberWash.addColorStop(0, 'rgba(255,45,18,0.2)');
    emberWash.addColorStop(0.55, 'rgba(255,70,20,0.07)');
    emberWash.addColorStop(1, 'rgba(255,70,20,0)');
    ctx.fillStyle = emberWash;
    ctx.fillRect(0, 0, w, h);

    this.chamferedRect(ctx, 18, 18, w - 36, h - 36, 28);
    ctx.strokeStyle = 'rgba(255,122,24,0.7)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // A CENTRED stack that actually fills the card. The old layout crammed a
    // boxed logo and one word into the top-left and left the bottom half and
    // right third of a 1280x640 canvas completely empty.
    this.drawMark(ctx, cx, 148, 300);

    ctx.font = "800 26px system-ui, sans-serif";
    ctx.fillStyle = 'rgba(214,222,232,0.62)';
    ctx.fillText('N O W   E N T E R I N G', cx, 262);

    ctx.font = "900 76px 'Arial Black', system-ui, sans-serif";
    ctx.fillStyle = '#f4f6fa';
    ctx.shadowColor = 'rgba(255,74,24,0.72)';
    ctx.shadowBlur = 18;
    ctx.fillText(this.destination, cx, 330);
    ctx.shadowBlur = 0;

    if (this.strap) {
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.fillStyle = 'rgba(255,176,0,0.78)';
      ctx.fillText(this.strap, cx, 390);
    }

    // A single progress rail spanning the card, filled to real progress.
    const railW = w - 300;
    const railX = (w - railW) / 2;
    const railY = 456;
    const railH = 14;
    this.chamferedRect(ctx, railX, railY, railW, railH, 4);
    ctx.fillStyle = 'rgba(105,116,132,0.22)';
    ctx.fill();
    const fill = Math.max(0.04, Math.min(1, this.progress)) * railW;
    this.chamferedRect(ctx, railX, railY, fill, railH, 4);
    ctx.fillStyle = '#ff7a18';
    ctx.shadowColor = '#ff4a18';
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    // A hot cap riding the head of the fill.
    this.chamferedRect(ctx, railX + Math.max(0, fill - 26), railY - 2, 26, railH + 4, 4);
    ctx.fillStyle = '#ffb000';
    ctx.fill();

    ctx.font = "800 22px system-ui, sans-serif";
    ctx.fillStyle = 'rgba(214,222,232,0.5)';
    ctx.fillText('LOADING', cx, 520);

    this.texture.needsUpdate = true;
  }
}
