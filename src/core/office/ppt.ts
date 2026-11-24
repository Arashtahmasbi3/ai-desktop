import { zipStore } from '@shared/zip-store'
import { escapeXml } from './ooxml'

/**
 * A minimal, structurally complete presentation (T09).
 *
 * PowerPoint needs a slide master and a layout before it will show a slide, so the package carries one of each plus a
 * theme: the smallest set that opens rather than merely unzips. Content per slide is a title and bullet lines — no
 * images, transitions or speaker notes.
 *
 * What the test can prove without PowerPoint is structure: every relationship target resolves to a part that exists.
 * "It opens" is a claim this file does not make on its own.
 */
export interface PptxSlide {
  title: string
  bullets?: string[]
}

export interface PptxSpec {
  slides: PptxSlide[]
}

const XMLNS_P = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`

/** The empty shape tree every slide, layout and master needs. */
const EMPTY_SP_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>`

function textShape(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  paragraphs: string[],
  bold: boolean
): string {
  const body = paragraphs
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="fa-IR"${bold ? ' b="1"' : ''}/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`
    )
    .join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AI Desktop">
  <a:themeElements>
    <a:clrScheme name="AI Desktop">
      <a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2>
      <a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2>
      <a:accent3><a:srgbClr val="EA580C"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4>
      <a:accent5><a:srgbClr val="0EA5E9"/></a:accent5><a:accent6><a:srgbClr val="DB2777"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="AI Desktop">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="AI Desktop">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`

export function buildPptx(spec: PptxSpec): Buffer {
  const slides = spec.slides.slice(0, 50)

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides
  .map(
    (_slide, index) =>
      `  <Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  )
  .join('\n')}
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${XMLNS_P}>
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slides.map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${slides
  .map(
    (_slide, index) =>
      `  <Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
  )
  .join('\n')}
  <Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`

  const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${XMLNS_P}><p:cSld>${EMPTY_SP_TREE}</p:cSld>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`

  const masterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`

  const layout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${XMLNS_P} type="blank"><p:cSld name="Blank">${EMPTY_SP_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

  const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`

  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'ppt/presentation.xml': presentation,
    'ppt/_rels/presentation.xml.rels': presentationRels,
    'ppt/slideMasters/slideMaster1.xml': master,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRels,
    'ppt/slideLayouts/slideLayout1.xml': layout,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': layoutRels,
    'ppt/theme/theme1.xml': THEME
  }

  slides.forEach((slide, index) => {
    const bullets = (slide.bullets ?? []).slice(0, 20)
    const shapes = [
      textShape(2, 'Title', 838200, 365125, 10515600, 1325563, [slide.title], true),
      bullets.length > 0 ? textShape(3, 'Body', 838200, 1825625, 10515600, 4351338, bullets, false) : ''
    ].join('')
    files[`ppt/slides/slide${index + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${XMLNS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`
  })

  return zipStore(files)
}
