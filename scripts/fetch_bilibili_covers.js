/**
 * fetch_bilibili_covers.js — 从 B站 API 获取封面替换 hdslb CDN 图片
 * ====================================================================
 * 用法: /d/softwa/nodejs/node scripts/fetch_bilibili_covers.js
 */
const path = require('path');
const fs = require('fs');

(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const t = line.trim(); if (!t || t.startsWith('#')) return;
        const eq = t.indexOf('='); if (eq === -1) return;
        process.env[t.slice(0,eq).trim()] = t.slice(eq+1).trim();
    });
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    // 1. Get unique bvids needing covers
    console.log('📊 查询需要换封面的 bvid...');
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=bvid&cover_url=ilike.*hdslb*&order=bvid.asc&limit=1200`, {headers:H});
    const songs = await resp.json();
    const bvids = [...new Set(songs.map(s => s.bvid).filter(Boolean))];
    console.log(`  → ${bvids.length} 个唯一 bvid，覆盖 ${songs.length} 首歌\n`);

    let updated = 0, failed = 0;

    for (let i = 0; i < bvids.length; i++) {
        const bvid = bvids[i];
        console.log(`[${i+1}/${bvids.length}] ${bvid}`);

        // Get cover from B站 API
        let coverUrl = null;
        try {
            const bResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                headers: {'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'}
            });
            const bData = await bResp.json();
            if (bData?.data?.pic) {
                coverUrl = bData.data.pic;
                console.log(`  → ${coverUrl}`);
            } else {
                console.log(`  ✗ 无封面数据`);
                failed++;
                continue;
            }
        } catch (err) {
            console.log(`  ✗ API错误: ${err.message}`);
            failed++;
            continue;
        }

        // Batch update all songs with this bvid
        const patchResp = await fetch(
            `${SUPABASE_URL}/rest/v1/songs?bvid=eq.${bvid}&cover_url=ilike.*hdslb*`,
            { method:'PATCH', headers:{...H,'Prefer':'return=minimal'}, body:JSON.stringify({cover_url:coverUrl}) }
        );
        if (patchResp.ok) {
            // Count how many were updated
            const countHdr = patchResp.headers.get('content-range');
            console.log(`  ✓ 批量更新成功`);
            updated++;
        } else {
            const err = await patchResp.text();
            console.log(`  ✗ 更新失败: ${err.slice(0,80)}`);
            failed++;
        }

        if (i < bvids.length - 1) await sleep(500);
    }

    // Verify
    const verify = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=count&cover_url=ilike.*hdslb*&limit=1`, {headers:H});
    const vData = await verify.json();
    console.log(`\n========== 完成 ==========`);
    console.log(`bvid 处理: ${updated} 成功, ${failed} 失败`);
    console.log(`剩余 B站 CDN 封面: ${vData[0]?.count || 0} 首`);
}

main().catch(e => { console.error(e); process.exit(1); });
