// Minimal PDF builder — enough for pdf.js to report text positions and image
// placements, which is all the photo pairer looks at.
//   pages: [{ lines: [{x,y,size,text}], images: [{x,y,w,h}] }]
import fs from 'node:fs';

// Paths resolve from this file, so the suite runs from any checkout.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');


export function buildPdf(pages) {
  const chunks = [];
  const offsets = [];
  let len = 0;
  const put = (buf) => { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1'); chunks.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    put(`${n} 0 obj\n`);
    put(body);
    if (stream != null) { put('\nstream\n'); put(stream); put('\nendstream'); }
    put('\nendobj\n');
  };

  // 2x2 RGB pixels, uncompressed — smallest thing pdf.js will decode as an image.
  const IMG = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const N = pages.length;
  const FONT = 3 + N * 2;        // font object
  const IMGO = FONT + 1;         // image xobject

  put('%PDF-1.4\n');
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  obj(1, `<</Type/Catalog/Pages 2 0 R>>`);
  obj(2, `<</Type/Pages/Kids[${kids}]/Count ${N}>>`);

  pages.forEach((pg, i) => {
    const pageNo = 3 + i * 2, contentNo = pageNo + 1;
    let cs = '';
    for (const l of pg.lines || []) {
      const esc = String(l.text).replace(/([\\()])/g, '\\$1');
      cs += `BT /F1 ${l.size || 10} Tf 1 0 0 1 ${l.x} ${l.y} Tm (${esc}) Tj ET\n`;
    }
    for (const im of pg.images || []) cs += `q ${im.w} 0 0 ${im.h} ${im.x} ${im.y} cm /Im1 Do Q\n`;
    obj(pageNo,
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]` +
      `/Resources<</Font<</F1 ${FONT} 0 R>>/XObject<</Im1 ${IMGO} 0 R>>>>` +
      `/Contents ${contentNo} 0 R>>`);
    obj(contentNo, `<</Length ${cs.length}>>`, cs);
  });

  obj(FONT, `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`);
  obj(IMGO, `<</Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceRGB/BitsPerComponent 8/Length ${IMG.length}>>`, IMG);

  const xrefAt = len;
  const count = IMGO + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  put(xref);
  put(`trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

// ---- A messy PRIVATE report: room headings, prose defects, photo clusters
// sitting UNDER the text they belong to, one cluster spilling onto page 2.
export const PRIVATE = buildPdf([
  {
    lines: [
      { x: 60, y: 755, size: 14, text: 'HomeSure Independent Property Inspections' },
      { x: 60, y: 735, size: 10, text: 'Lot 905 (11) Woodlawn Rd, Wollert  -  Practical Completion' },
      { x: 60, y: 700, size: 12, text: 'KITCHEN' },
      { x: 60, y: 682, size: 10, text: 'Paint finish to the kitchen ceiling is patchy and requires a further coat' },
      { x: 60, y: 668, size: 10, text: 'throughout to achieve an even finish.' },
      { x: 60, y: 500, size: 10, text: 'Grout to the splashback is cracked in several places and needs raking out' },
      { x: 60, y: 486, size: 10, text: 'and re-grouting.' },
    ],
    images: [
      { x: 60, y: 530, w: 200, h: 130 },
      { x: 280, y: 530, w: 200, h: 130 },
      { x: 60, y: 330, w: 200, h: 130 },
    ],
  },
  {
    // The cluster for the splashback item ran past the page break.
    lines: [
      { x: 60, y: 560, size: 12, text: 'ENSUITE' },
      { x: 60, y: 542, size: 10, text: 'Shower screen is not sealed to the tiled hob and water is escaping.' },
    ],
    images: [
      { x: 60, y: 600, w: 200, h: 130 },
      { x: 60, y: 380, w: 200, h: 130 },
    ],
  },
]);

// ---- A BPI-shaped report: numbered Tag lines with the photo beside/below.
export const BPI = buildPdf([
  {
    lines: [
      { x: 60, y: 755, size: 12, text: 'Report With Supporting Photos' },
      { x: 60, y: 700, size: 10, text: '1 Kitchen Paint touch ups required to ceiling' },
      { x: 60, y: 520, size: 10, text: '2 Ensuite Silicone to shower hob incomplete' },
    ],
    images: [
      { x: 60, y: 560, w: 200, h: 130 },
      { x: 60, y: 360, w: 200, h: 130 },
    ],
  },
]);

if (process.argv[2]) {
  const OUT = process.argv[2];
  fs.writeFileSync(OUT + '/private-report.pdf', PRIVATE);
  fs.writeFileSync(OUT + '/bpi-report.pdf', BPI);
  console.log('wrote private-report.pdf (' + PRIVATE.length + 'b), bpi-report.pdf (' + BPI.length + 'b)');
}
