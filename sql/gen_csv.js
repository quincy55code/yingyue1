// Generate CSV from B站 BV1pr6aYiE97 pages
const fs = require('fs');
const path = require('path');
const BV = 'BV1pr6aYiE97';

async function main() {
  const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${BV}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.bilibili.com/'
    }
  });
  const data = await resp.json();
  const pages = data.data.pages;

  // CSV header
  const csvEscape = (s) => {
    if (s == null) return '';
    const str = String(s);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = ['title,singer,bilibili_url,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url'];

  for (const p of pages) {
    const part = p.part; // e.g. "001. 郁可唯 - 去有风的地方"
    const page = p.page;
    const duration = p.duration;
    const cover = (p.first_frame || '').replace('http://', 'https://');

    // Parse "001. Singer - Title"
    const withoutNum = part.replace(/^\d+\.\s*/, '');
    const dashIdx = withoutNum.indexOf(' - ');
    const singer = dashIdx > -1 ? withoutNum.substring(0, dashIdx) : '';
    const title = dashIdx > -1 ? withoutNum.substring(dashIdx + 3) : withoutNum;
    const url = `https://www.bilibili.com/video/${BV}/?p=${page}`;

    lines.push([
      csvEscape(title),
      csvEscape(singer),
      csvEscape(url),
      BV,
      page,
      '',  // start_seconds
      '',  // end_seconds
      duration,
      csvEscape(cover)
    ].join(','));
  }

  const out = lines.join('\n');
  const outPath = path.join(__dirname, 'songs_100.csv');
  fs.writeFileSync(outPath, out, 'utf8');
  console.log(`Done! ${pages.length} songs written to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
