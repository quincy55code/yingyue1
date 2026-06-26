/**
 * check_foreign_swaps.js — 检测英文/日文歌曲的 title/singer 互换
 * 用法: /d/softwa/nodejs/node scripts/check_foreign_swaps.js
 */

const path = require('path');
const fs = require('fs');

// Load .env
(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && value) process.env[key] = value;
    });
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

// BVs already fixed by fix_swapped_songs.js v2
const FIXED_BVIDS = new Set([
    'BV1Wg4heQEQU','BV1KXjF6REto','BV1ChR7B4ECE','BV1vg4y1U7Xf',
    'BV17vLz62EHG','BV1Ei421i7mm','BV1cUjW61EFN','BV1Y2w4zXEJ9',
    'BV1GSEj6UEaN','BV1tyKceWETg','BV1qpsPznEWJ','BV1fDqiYNEuf',
    'BV1NURNBtETP','BV1QC4y1P7YG','BV1RnEL6UEkY','BV1SrbkzxEVi',
    'BV1e9Lo64EJx','BV1BALF6NENq','BV1pr6aYiE97'
]);

function hasForeign(str) {
    if (!str) return false;
    // English: 3+ consecutive ASCII letters
    // Japanese: hiragana, katakana, kanji
    return /[a-zA-Z]{3,}/.test(str) || /[ぁ-ゟ゠-ヿ一-鿿]/.test(str);
}

function isEnglish(str) {
    if (!str) return false;
    const ascii = str.replace(/[^\x00-\x7F]/g, '').length;
    return ascii > 0 && ascii / str.length > 0.5;
}

function isJapanese(str) {
    if (!str) return false;
    return /[ぁ-ゟ゠-ヿ一-鿿]/.test(str);
}

function detectSwap(song) {
    const title = song.title || '';
    const singer = song.singer || '';

    // Skip if no foreign content
    if (!hasForeign(title) && !hasForeign(singer)) return null;

    // Pattern 1: title looks like artist name (1-3 short words), singer looks like song title
    // This catches cases like: title="Eminem" singer="Lose Yourself"
    const titleWords = title.split(/[\s\/,&]+/).filter(Boolean);
    const singerWords = singer.split(/[\s\/,&]+/).filter(Boolean);

    // Pattern 2: Title is a common English artist pattern
    // (1-2 words, no special chars beyond &/')
    // Singer is longer and more descriptive
    if (isEnglish(title) && isEnglish(singer)) {
        // If title is short (likely artist name) and singer is longer (likely song)
        if (titleWords.length <= 2 && singerWords.length > titleWords.length && singerWords.length >= 2) {
            return 'en-artist-title';
        }
        // If title has common English name pattern vs singer has more content
        if (/^[A-Z][a-z]+(\s[A-Z][a-z]+){0,2}$/.test(title) && singerWords.length >= 3) {
            return 'en-name-title';
        }
    }

    // Pattern 3: Mixed - title is one language artist, singer is another language song
    if (isJapanese(title) && isEnglish(singer)) {
        return 'jp-title-en-singer';
    }
    if (isEnglish(title) && isJapanese(singer)) {
        // title could be English song name with Japanese singer (correct!)
        // OR English artist name with Japanese song title (swapped!)
        // Heuristic: if title is short (1-2 words), it might be artist name
        if (titleWords.length <= 2 && singer.length > 6) {
            return 'en-artist-jp-song';
        }
        return null; // likely correct: English song, Japanese artist
    }

    // Pattern 4: Japanese artist name as title (short, 2-4 chars), longer song title as singer
    if (isJapanese(title) && isJapanese(singer)) {
        if (title.length <= 6 && singer.length > 8) {
            return 'jp-short-title';
        }
    }

    // Pattern 5: Both are English but title has "feat.", "vs.", "&" — common in artist names
    // Actually, "feat." is more common in song titles. Let's check the other way.

    // Pattern 6: Title is all-caps or has special artist-like patterns
    if (/^[A-Z]{2,}$/.test(title) && singerWords.length >= 2) {
        return 'en-acronym-title';
    }

    return null;
}

async function main() {
    console.log('🔍 检测英文/日文歌曲 title/singer 互换...\n');

    // Fetch all songs
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,bvid,page,title,singer&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) break;
        const page = await resp.json();
        if (!page || page.length === 0) break;
        allSongs = allSongs.concat(page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    console.log(`总计 ${allSongs.length} 首歌\n`);

    // Filter for foreign content, excluding already-fixed BVs
    const candidates = allSongs.filter(s => !FIXED_BVIDS.has(s.bvid) && hasForeign(s.title) || hasForeign(s.singer));
    console.log(`含英文/日文内容（未修复 BV）: ${candidates.length} 首\n`);

    // Detect swaps
    const swaps = [];
    const clean = [];

    for (const s of candidates) {
        const reason = detectSwap(s);
        if (reason) {
            swaps.push({ ...s, reason });
        } else {
            clean.push(s);
        }
    }

    // Group by bvid
    const byBvid = {};
    for (const s of swaps) {
        if (!byBvid[s.bvid]) byBvid[s.bvid] = [];
        byBvid[s.bvid].push(s);
    }

    console.log(`⚠️  疑似互换: ${swaps.length} 首`);
    console.log(`✅ 看起来正确: ${clean.length} 首\n`);

    console.log('='.repeat(80));
    console.log('按 BV 分组（疑似互换）:');
    console.log('='.repeat(80));

    for (const [bvid, ss] of Object.entries(byBvid).sort()) {
        console.log(`\n${bvid} (${ss.length} 首):`);
        for (const s of ss) {
            console.log(`  #${s.id} p${s.page} [${s.reason}] title="${s.title}" singer="${s.singer}"`);
        }
    }

    // Also show clean English/Japanese songs for reference
    const cleanByBvid = {};
    for (const s of clean) {
        if (!cleanByBvid[s.bvid]) cleanByBvid[s.bvid] = [];
        cleanByBvid[s.bvid].push(s);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('看起来正确的英文/日文歌曲（参考）:');
    console.log('='.repeat(80));

    for (const [bvid, ss] of Object.entries(cleanByBvid).sort()) {
        console.log(`\n${bvid} (${ss.length} 首):`);
        for (const s of ss.slice(0, 5)) {
            console.log(`  #${s.id} p${s.page} title="${s.title}" singer="${s.singer}"`);
        }
        if (ss.length > 5) console.log(`  ... 还有 ${ss.length - 5} 首`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
