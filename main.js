const C = {
    note: { tap: 1, drag: 2, hold: 3, flick: 4 },
    units: { pgrw: 0.05625, pgrh: 0.6, pgrbeat: 60 / 32 },
    linew: 0.0075,
    lineh: 5.76,
    pcolor: [0xff, 0xec, 0x9f],
    palpha: 0xe1 / 0xff,

    /* 方块材质，数值逐条抄自 ActiveBlock.mat / DisabledBlock.mat / ReadyBlock.mat。

       原版方块不是「红方块 + 噪声贴图」，而是四段 RT 管线：
         BlockArea/BlockSprite 画进 _NormalBlockRT/_SubtractBlockRT
           -> Unlit/BlockCompose  用 _DisplaceMap 位移后合成 _ComposeRT
           -> Unlit/EdgeMask/GlowMask 从 _ComposeRT 膨出描边与辉光 (_EffectRT)
           -> Unlit/ActiveBlock(全屏) 把 _ComposeRT/_EffectRT/_SceneColor 合成到屏幕
       位移图全程只做两件事：挪采样坐标、调制火花亮度 —— 它本身不出现在画面上。
       注意「挪采样坐标」挪的是 mask 和「取色用」的场景采样，不是画面里的背景：
       背景永远取未位移的那一份，否则方块内部会整片错位、边界处撕出接缝。 */
    block: {
        displaceStrength: 0.15,   // ActiveBlock/DisabledBlock 的 _DisplaceStrength
        displaceDir: [1, 1],      // _DisplaceDirection
        /* 位移图采样网格。原版 ActiveBlock 是 floor(uv * _ScreenParams / _BackgroundPixelScale)，
           格子 = 6×6 屏幕像素、取格心，格数跟着分辨率走（1080p 下横向 320 格）。
           照抄原版，不做分辨率解耦。 */
        pixelScale: 6,            // _BackgroundPixelScale：位移图采样量化到 6px 一格

        /* 描边/辉光的真实参数取自 BlockRender.prefab 628–631（HANDOFF §3.6、§8-5 已复核）：
             edgeSize = 1                       ⇒ 只跑一趟膨胀，没有 ping 乒乓
             glowRadius = 6、glowWeightFalloff = 2.65、glowPassWeightThreshold = 0.01
           权重 w(i) = pow(6−i, 2.65) / Σ_{k=1..6} pow(k, 2.65)
             = 0.458568 / 0.282861 / 0.156589 / 0.073059 / 0.024948 / 0.003975
           w(5) = 0.003975 < 0.01 被阈值切掉 ⇒ 正好 **5 趟**，辉光半径 5 texel = 20 屏幕 px。
           步长不在这儿配：它是 1 个 effectRT texel = 4 屏幕 px（_DilateTexelSize =
           1/effectRT 尺寸，effectRT = w/4），由尺寸推导，见 fx_blocks 的 u_texel。
           ⚠️ 这里原来写的 `ringTexels: 1（原 4）` / `glowTexels: 2（原 8）` 是错的临时值，
           「原 4 / 原 8」凭空捏造，已随 §7-5 删除。 */
        glowRadius: 6,            // BlockRender.glowRadius
        glowFalloff: 2.65,        // BlockRender.glowWeightFalloff
        glowThreshold: 0.01,      // BlockRender.glowPassWeightThreshold

        /* 合成 mask 那一步（BlockCompose.mat）自己带一套位移参数，和全屏上色那一步
           （ActiveBlock/DisabledBlock）不是一组数。混用会把方块轮廓整体扯歪：
           _DisplaceMap_ST 决定噪声铺多密、_DisplaceStrength 决定抖多狠。

           BlockCompose 有两个 pass：主 pass（Active）拿 _NormalBlockRT/_SubtractBlockRT
           位移后相减；disabled pass 拿 _DisabledNormalBlockRT/_DisabledSubtractBlockRT，
           而那一趟里 _DisplaceMap/_Time 这些 uniform 压根没声明 —— 位移量就是 0，
           mask 按原始 uv 取。所以 disabled 的轮廓是干净矩形，抖的是 Active。 */
        compose: {
            displaceST: [2.13, 1.02], displaceSpeed: 2.59,
            displaceStrength: 0.1, displaceStrengthD: 0
        },

        // Unlit/ActiveBlock
        active: {
            fillColor: [0.7132075, 0.23549296, 0.23549296], fillOpacity: 0.667,
            fillStrength: 0.667,   // _FillStrength：填色向「场景色 hue 偏移 + 火花 overlay」靠多少
            edgeColor: [1, 0.33018857, 0.33018857], edgeOpacity: 0.8,
            glowColor: [1, 0.17924517, 0.17924517], glowIntensity: 0.8,
            sparkTint: [1, 0.28490567, 0.28490567], sparkOpacity: 5.69,
            sparkDisplace: 2.39, sparkHueShift: 0.2,
            displaceST: [0.8, 0.3], displaceSpeed: 1.5, displaceBlend: 0.411,
            sparkST: [3, 1.2]
        },
        /* Unlit/DisabledBlock 只编了 _RENDERPART_FILL 这一个变体（.mat 的 _InvalidKeywords
           就写着 _RENDERPART_FILL），出来只有「填色 + 火花」：_EdgeColor/_GlowColor/
           _SparkHueShiftAmount/_FillStrength 在材质里留着但这一变体根本不引用，所以不抄。
           填色公式是 cov * (_FillColor*_FillOpacity + 火花) —— _FillOpacity 乘的是颜色不是
           alpha，和 ActiveBlock 正好相反；变暗靠乘颜色，不是靠降不透明度。 */
        disabled: {
            fillColor: [0.497, 0.13766898, 0.13766898], fillOpacity: 0.4,
            sparkTint: [0.31132078, 0.077830195, 0.077830195], sparkOpacity: 3.5,
            sparkDisplace: 2.29,
            displaceST: [0.5, 0.2], displaceSpeed: 0.3,
            sparkST: [3, 1.2]
        },
        // Unlit/ReadyBlock：只有一层很暗的白色呼吸微光
        ready: { shineColor: [1, 1, 1], shineBrightness: 0.12, shineSpeed: 37.9 },

        imgs: {}
    },

    click_sounds: {},
    note_imgs: {},
    chart: {},
    hit_fx_imgs: [],
    fx_enabled: true,
    fx_failed: false,
    block_enabled: true
};

const cv = document.querySelector("#main-canvas");
const ctx = cv.getContext("2d");
const actx = new AudioContext();

const el = id => document.querySelector(id);
const ui = {
    btn_play: el("#btn-play"),
    progress_wrap: el("#progress-wrap"),
    progress_fill: el("#progress-fill"),
    progress_marks: el("#progress-marks"),
    time_label: el("#time-label"),
    start_overlay: el("#start-overlay"),
    loading_overlay: el("#loading-overlay"),
    loading_fill: el("#loading-fill"),
    loading_text: el("#loading-text"),
    btn_library: el("#btn-library"),
    library_overlay: el("#library-overlay"),
    library_grid: el("#library-grid"),
    library_count: el("#library-count"),
    library_close: el("#library-close"),
    loading_overlay: el("#loading-overlay"),
    loading_label: el("#loading-label"),
    loading_fill: el("#loading-fill"),
    loading_text: el("#loading-text")
};

const load_audio = async (url, on_progress) => {
    const resp = await fetch(url);
    // 音频要 decodeAudioData，进度按字节比例报（解码耗时算不进进度条，但解码很快）
    return await actx.decodeAudioData(await read_with_progress(resp, on_progress));
};

const load_text = async url => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
    return await resp.text();
};

// 下载带进度：resp.body 缺失（老浏览器/被 polyfill 掉）时退化成一次读完，至少不报错。
// total 来自 Content-Length，没有就只报「已下载多少字节」，UI 侧当未知总量处理。
const read_with_progress = async (resp, on_progress) => {
    if (!on_progress) return await resp.arrayBuffer();
    const total = Number(resp.headers.get("content-length")) || 0;
    if (!resp.body || !resp.body.getReader) {
        const buf = await resp.arrayBuffer();
        on_progress(buf.byteLength, total || buf.byteLength);
        return buf;
    }
    const reader = resp.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.byteLength;
        on_progress(got, total);
    }
    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out.buffer;
};

const play_sound = buf => {
    if (!buf) return;
    const source = actx.createBufferSource();
    source.buffer = buf;
    source.connect(actx.destination);
    source.start();
};

const load_img = async url => {
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
    });
    return img;
};

const load_json = async url => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status} ${url}`);
    return await resp.json();
};

const load_json_or_null = async url => {
    try {
        return await load_json(url);
    } catch (e) {
        return null;
    }
};

const clip_img = (img, y0, y1) => {
    const tempcv = document.createElement("canvas");
    tempcv.width = img.width;
    tempcv.height = y1 - y0;
    const tempctx = tempcv.getContext("2d");
    tempctx.drawImage(img, 0, -y0);
    return tempcv;
};

const clip_block_img = (img, x0, y0, x1, y1) => {
    const tempcv = document.createElement("canvas");
    tempcv.width = x1 - x0;
    tempcv.height = y1 - y0;
    const tempctx = tempcv.getContext("2d");
    tempctx.drawImage(img, -x0, -y0);
    return tempcv;
};

const clip_hold = (img, atlas) => {
    const tail = clip_img(img, 0, atlas[0]);
    const body = clip_img(img, atlas[0], img.height - atlas[1]);
    const head = clip_img(img, img.height - atlas[1], atlas[1]);
    return [head, body, tail];
};

const load_audioele = async (url, on_progress) => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    // <audio> 自己拉取，进度只能从 progress 事件拿（buffered ranges），粗略但可用
    if (on_progress) {
        const h = () => {
            if (audio.buffered.length > 0 && audio.duration) {
                const loaded = audio.buffered.end(audio.buffered.length - 1);
                on_progress(loaded, audio.duration);
            }
        };
        audio.addEventListener("progress", h);
        audio.addEventListener("canplaythrough", () => {
            audio.removeEventListener("progress", h);
            on_progress(audio.duration, audio.duration);
        });
    }
    await new Promise((resolve, reject) => {
        audio.oncanplaythrough = resolve;
        audio.onerror = reject;
    });
    return audio;
};

const linear = (t, st, et, sv, ev) => sv + (t - st) / (et - st) * (ev - sv);

// 事件选取复刻游戏 JudgeLineControl.UpdateJudgeLineEventIndex：索引单调前进到
// 「第一个 endTime > t 的事件」；t 落在事件间隙里时取的是「间隙之后那条」（再从它的
// startTime 反向外推）；t 超过全部事件时钳到最后一条。游戏永远不会出现「找不到事件」，
// 所以旧版在空隙/首事件之前直接 return -1 是错的 —— get_fp 会因此把 linefp 变成硬编码
// 的 0，note 位置整片错掉（实测 DS-AT line4 能偏到 -63782）。endTime 在合法谱面里随
// startTime 单调不减（连续或带间隙都成立），所以可以二分。
const find_event = (t, es) => {
    let l = 0, r = es.length - 1;
    let ans = es.length - 1;   // 没有 endTime > t 的事件 ⇒ 钳到最后一条（游戏的 -1 修正）
    while (l <= r) {
        const m = Math.floor((l + r) / 2);
        if (es[m].endTime > t) { ans = m; r = m - 1; }
        else l = m + 1;
    }
    return ans;
};

/* easeType -> f(p)。原版 GetEase.GetEaseWithProgress 不是直接算函数，而是把 [0,1] 按 1%
   采样成 101 项查表再线性插值；表由静态初始化生成，指数 n = (type-1)//3 + 2，
   (type-1)%3 决定 In / Out / InOut。13 = Zero（恒 0），14 = One（恒 1），
   15 = AnimationCurve 不在内置表里。枚举名和曲线并不一致（InSine 其实是二次幂，没有正弦）。
   这里照抄这份表，保证逐项和反编译结果一致。 */
const ease_table = (() => {
    const tbl = [];
    for (let type = 0; type <= 14; type++) {
        const row = new Float32Array(101);
        if (type >= 1 && type <= 12) {
            const n = Math.floor((type - 1) / 3) + 2;
            const kind = (type - 1) % 3;
            for (let i = 0; i <= 100; i++) {
                const p = i / 100;
                if (kind === 0) row[i] = Math.pow(p, n);
                else if (kind === 1) row[i] = 1 - Math.pow(1 - p, n);
                else row[i] = p < 0.5 ? 0.5 * Math.pow(2 * p, n) : 1 - 0.5 * Math.pow(2 - 2 * p, n);
            }
        } else if (type === 14) {
            row.fill(1);
        } else if (type !== 13) {
            for (let i = 0; i <= 100; i++) row[i] = i / 100;   // 0 = Liner
        }
        tbl[type] = row;
    }
    return tbl;
})();

const ease = (p, type) => {
    const row = ease_table[type] || ease_table[0];
    if (p <= 0) return row[0];
    if (p >= 1) return row[100];
    const x = p * 100;
    const i = Math.floor(x);
    return row[i] + (x - i) * (row[i + 1] - row[i]);
};

const init_speed_events = es => {
    let fp = 0.0;
    for (const e of es) {
        e.floorPosition = fp;
        fp += (e.endTime - e.startTime) * e.value;
    }
};

const merge_notes = (above, below) => {
    for (const note of above) note.is_above = true;
    for (const note of below) note.is_above = false;
    return [...above, ...below];
};

const init_note_fp = (notes, ses) => {
    for (const note of notes) note.floorPosition = get_fp(note.time, ses);
};

const get_event_val = (t, es, sn, en) => {
    const i = find_event(t, es);
    if (i === -1) return 0.0;
    const e = es[i];
    return linear(t, e.startTime, e.endTime, e[sn], e[en]);
};

const get_fp = (t, es) => {
    const i = find_event(t, es);
    if (i === -1) return 0.0;
    const e = es[i];
    return e.floorPosition + (t - e.startTime) * e.value;
};

const rotate_point = (x, y, r, deg) => {
    return [
        x + r * Math.cos(deg * Math.PI / 180),
        y + r * Math.sin(deg * Math.PI / 180)
    ];
};

const get_blur_img = (img, r) => {
    r *= (img.width + img.height);
    const tempcv = document.createElement("canvas");
    tempcv.width = img.width;
    tempcv.height = img.height;
    const tempctx = tempcv.getContext("2d");
    const morescale = Math.max(r / img.width, r / img.height);
    tempctx.scale(1 + morescale, 1 + morescale);
    tempctx.translate(-r / 2, -r / 2);
    tempctx.filter = `blur(${r}px)`;
    tempctx.drawImage(img, 0, 0);
    return tempcv;
};

const cv_put_color = (canvas, color) => {
    const c = canvas.getContext("2d");
    const imgdata = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imgdata.data.length; i += 4) {
        imgdata.data.set([
            Math.floor(imgdata.data[i] * color[0] / 0xff),
            Math.floor(imgdata.data[i + 1] * color[1] / 0xff),
            Math.floor(imgdata.data[i + 2] * color[2] / 0xff),
            imgdata.data[i + 3]
        ], i);
    }
    c.putImageData(imgdata, 0, 0);
    return canvas;
};

/* ---------------- 播放时钟 ----------------
   音频负责声音，时钟负责画面。
   这样音频放完（S6 只有 68.5s，但演出到 73.1s）画面还能继续走完。 */

const clock = { base: 0, perf: 0, running: false };

const clock_t = () => clock.running
    ? clock.base + (performance.now() - clock.perf) / 1000
    : clock.base;

const clock_seek = v => { clock.base = v; clock.perf = performance.now(); };

const clock_run = on => {
    if (on) {
        if (!clock.running) { clock.perf = performance.now(); clock.running = true; }
    } else if (clock.running) {
        clock.base = clock_t();
        clock.running = false;
    }
};

const get_time = () => {
    const m = C.chart.music;
    if (m && !m.paused && !m.ended && m.readyState >= 2) return m.currentTime;
    return clock_t();
};

/* ---------------- 曲线求值（方块事件 / 后期特效） ---------------- */

const curve_val = (keys, t) => {
    if (!keys || !keys.length) return 0;
    if (t <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (t >= last[0]) return last[1];
    for (let i = 0; i + 1 < keys.length; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t >= a[0] && t <= b[0]) {
            const span = b[0] - a[0];
            const p = span <= 0 ? 1 : (t - a[0]) / span;
            return a[1] + (b[1] - a[1]) * p;
        }
    }
    return last[1];
};

// 方块事件是按 time 的关键帧（没有 endTime），起点是上一个关键帧的值。
// 游戏语义：ease 来自 evs[i]（段起点事件），eased progress clamp 到 [0,1]。
const eval_xy_track = (t, evs, getv, dflt, ex, ey) => {
    if (!evs || !evs.length || t < evs[0].time) return { x: dflt[0], y: dflt[1] };
    let i = 0;
    while (i + 1 < evs.length && evs[i + 1].time <= t) i++;
    const a = getv(evs[i]);
    if (i + 1 >= evs.length) return { x: a.x, y: a.y };
    const b = getv(evs[i + 1]);
    const span = evs[i + 1].time - evs[i].time;
    const p = span <= 0 ? 1 : (t - evs[i].time) / span;
    // ease 从 evs[i]（段起点），eased 值 clamp [0,1]
    const pa = Math.max(0, Math.min(1, ease(p, evs[i][ex] ?? 0)));
    const pb = Math.max(0, Math.min(1, ease(p, evs[i][ey] ?? 0)));
    return { x: a.x + (b.x - a.x) * pa, y: a.y + (b.y - a.y) * pb };
};

const eval_num_track = (t, evs, getv, dflt, ek) => {
    if (!evs || !evs.length || t < evs[0].time) return dflt;
    let i = 0;
    while (i + 1 < evs.length && evs[i + 1].time <= t) i++;
    const a = getv(evs[i]);
    if (i + 1 >= evs.length) return a;
    const b = getv(evs[i + 1]);
    const span = evs[i + 1].time - evs[i].time;
    const p = span <= 0 ? 1 : (t - evs[i].time) / span;
    // ease 从 evs[i]，clamp
    return a + (b - a) * Math.max(0, Math.min(1, ease(p, evs[i][ek] ?? 0)));
};

/* ---------------- 方块层 ----------------
   BlockArea 四段时序：appear -> enable -> disable -> disappear
   [appear,enable) 用 Ready 材质（很暗的白色呼吸微光），[enable,disable) 用 Active，
   [disable,disappear) 用 Disabled。appear==enable / disable==disappear 时该段长度为 0。

   这里只负责把方块光栅化成两张 mask 贴图，对应原版那几个 w/8 的 mask RT
   （0xC0/0xC8 active、0xD0/0xD8 disabled∪ready、0xE0/0xE8 ready-only，见 HANDOFF §3.1）：
     C.block_cv     覆盖：R = Active，G = Disabled ∪ Ready，B = Ready
     C.block_sub_cv 减算：R = Active，G = Disabled ∪ Ready，B = Ready
   相位写到哪些通道（draw_block_mask 里的 PHASE_CH）：
     appear→enable（Ready）→ G 和 B；enable→disable（Active）→ R；disable→disappear → G。
   G 必须含 Ready：原版 r = composeD.x × readyRaw，appear 段还没有 disabled 覆盖，
   composeD 若不含 Ready 就恒为 0，方块微光永远出不来。B 只放 Ready，单独差出 readyRaw。
   分通道是必须的：原版 Active / Disabled / Ready 各有独立的 normal+subtract 一对 RT，谁都不
   减谁；要是减算只用一个通道，一个 Disabled 的 subtract 块就会把同位置的 Active 块也挖掉。
   两张画布按原版 RT 的尺寸 w/8 × h/8 光栅化（原版 mask 相机的 targetTexture 就是 /8，
   compose 也跑在 /8 上、Point 采样），坐标缩放做在 render_blocks 里，几何计算不用改。
   覆盖值已经乘过该块这一帧的淡入淡出系数（原版走 vertex color 的 alpha）。
   真正上色由后面的 WebGL 管线做（位移 -> 合成 -> 描边/辉光 -> 全屏叠加）。 */

// SafeDiv(num, den)：游戏用 |den| < ε ? 1.0 : num/den（ε 极小，只在 den≈0 时触发）
const safe_div = (a, b) => (Math.abs(b) < 1e-9 ? 1.0 : a / b);

// 方块几何变换：复刻游戏 UpdateBlockAnimations 管线（scale链 → rotate链 → move delta）
// 返回 { cx_px, cy_px, size_px: {x,y}, rotation }，坐标为 canvas 像素（y 下、原点左上）
const block_transform = (b, t, w, h) => {
    const bl = b.bottomLeftPercentage, tr = b.topRightPercentage;
    const base_pct = { x: (bl.x + tr.x) / 2, y: (bl.y + tr.y) / 2 };
    const size_pct = { x: tr.x - bl.x, y: tr.y - bl.y };
    
    // 1) Scale 链：center 按比值链式变换（世界坐标 = pct*屏幕尺寸，y 上），size = base × 当前绝对 scale
    let cx = base_pct.x * w, cy = (1 - base_pct.y) * h;  // canvas y 下翻转
    let cur_sc = { x: 1, y: 1 };
    const ses = b.scaleEvents || [];
    if (ses.length > 0 && t >= ses[0].time) {
        let i = 0;
        while (i + 1 < ses.length && ses[i + 1].time <= t) i++;
        // 已完成段：链式比值 scale_{j+1}/scale_j 绕 anchor_j
        for (let j = 0; j < i; j++) {
            const a = ses[j].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const rx = safe_div(ses[j + 1].scale.x, ses[j].scale.x);
            const ry = safe_div(ses[j + 1].scale.y, ses[j].scale.y);
            cx = ax + rx * (cx - ax);
            cy = ay + ry * (cy - ay);
        }
        // 当前段（若有下一个事件）：插值 scale，比值 = interp/scale_i
        if (i + 1 < ses.length) {
            const sc_interp = eval_xy_track(t, ses, e => e.scale, [1, 1], "easeTypeX", "easeTypeY");
            const a = ses[i].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const rx = safe_div(sc_interp.x, ses[i].scale.x);
            const ry = safe_div(sc_interp.y, ses[i].scale.y);
            cx = ax + rx * (cx - ax);
            cy = ay + ry * (cy - ay);
            cur_sc = sc_interp;
        } else {
            cur_sc = ses[i].scale;
        }
    }

    // 2) Rotate 链：center 按角度增量链式旋转（canvas y 下 → 旋转取反），rotation = 当前绝对值
    let cur_rot = 0;
    const res = b.rotateEvents || [];
    if (res.length > 0 && t >= res[0].time) {
        let i = 0;
        while (i + 1 < res.length && res[i + 1].time <= t) i++;
        for (let j = 0; j < i; j++) {
            const delta = res[j + 1].rotation - res[j].rotation;
            const a = res[j].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const th = -delta * Math.PI / 180;  // canvas y 下取反
            const dx = cx - ax, dy = cy - ay;
            cx = ax + dx * Math.cos(th) - dy * Math.sin(th);
            cy = ay + dx * Math.sin(th) + dy * Math.cos(th);
        }
        if (i + 1 < res.length) {
            const rot_interp = eval_num_track(t, res, e => e.rotation, 0, "easeType");
            const delta = rot_interp - res[i].rotation;
            const a = res[i].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const th = -delta * Math.PI / 180;
            const dx = cx - ax, dy = cy - ay;
            cx = ax + dx * Math.cos(th) - dy * Math.sin(th);
            cy = ay + dx * Math.sin(th) + dy * Math.cos(th);
            cur_rot = rot_interp;
        } else {
            cur_rot = res[i].rotation;
        }
    }

    // 3) Move delta：(movePct - basePct) × 屏幕尺寸 叠加到 center（y 翻转）
    const mv = b.moveEvents || [];
    if (mv.length > 0 && t >= mv[0].time) {
        const pos = eval_xy_track(t, mv, e => e.endPosition, [base_pct.x, base_pct.y], "easeTypeX", "easeTypeY");
        cx += (pos.x - base_pct.x) * w;
        cy += (base_pct.y - pos.y) * h;  // y 翻转
    }

    return {
        cx_px: cx,
        cy_px: cy,
        size_px: { x: Math.abs(size_pct.x * cur_sc.x) * w, y: Math.abs(size_pct.y * cur_sc.y) * h },
        rotation: cur_rot
    };
};

const block_state = (b, t) => {
    if (t < b.appearTime || t >= b.disappearTime) return null;
    if (t < b.enableTime) {
        const span = b.enableTime - b.appearTime;
        return { phase: 0, alpha: span <= 0 ? 1 : (t - b.appearTime) / span };
    }
    if (t < b.disableTime) return { phase: 1, alpha: 1 };
    const span = b.disappearTime - b.disableTime;
    return { phase: 2, alpha: span <= 0 ? 1 : 1 - (t - b.disableTime) / span };
};

const draw_block_mask = (bctx, b, t, w, h, sub) => {
    const st = block_state(b, t);
    if (!st || st.alpha <= 0.002) return false;

    const geom = block_transform(b, t, w, h);
    const { cx_px: cx, cy_px: cy, size_px: sz, rotation } = geom;
    const bw = sz.x, bh = sz.y;
    if (bw < 0.5 || bh < 0.5) return false;

    bctx.save();
    bctx.translate(cx, cy);
    bctx.rotate(-rotation * Math.PI / 180);

    // 通道值 = 覆盖 * 淡入淡出系数，直接写进颜色里（canvas 的 alpha 通道被预乘绑死了，不能用）
    // 通道约定和 phase 序号不是一回事：R=Active、G=Disabled∪Ready、B=Ready（见本节开头注释）。
    // Ready（phase 0）同时写 G 和 B：G 让 composeD 覆盖到 appear 段，B 单独留给 readyRaw。
    const PHASE_CH = [[1, 2], [0], [1]];
    const v = Math.round(255 * Math.min(1, st.alpha));
    const col = [0, 0, 0];
    for (const ch of PHASE_CH[st.phase]) col[ch] = v;
    bctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    bctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    bctx.restore();
    return true;
};

// 没有 WebGL 时的退路：把 mask 当纯色方块直接画上去，没有位移/火花/辉光
const draw_block_flat = (bctx, b, t, w, h, sub) => {
    const st = block_state(b, t);
    if (!st || st.alpha <= 0.002) return false;

    const geom = block_transform(b, t, w, h);
    const { cx_px: cx, cy_px: cy, size_px: sz, rotation } = geom;
    const bw = sz.x, bh = sz.y;
    if (bw < 0.5 || bh < 0.5) return false;

    bctx.save();
    bctx.globalAlpha = st.alpha;
    bctx.translate(cx, cy);
    bctx.rotate(-rotation * Math.PI / 180);

    const P = st.phase === 0 ? C.block.ready
        : st.phase === 1 ? C.block.active : C.block.disabled;
    if (sub) {
        bctx.globalCompositeOperation = "destination-out";
        bctx.fillStyle = "#000";
    } else {
        const c = st.phase === 0 ? P.shineColor : P.fillColor;
        const a = st.phase === 0 ? P.shineBrightness : P.fillOpacity;
        bctx.fillStyle = `rgba(${c.map(x => Math.round(x * 255)).join(",")},${a})`;
    }
    bctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    // Disabled 没有描边（FILL-only 变体），只有 Active 描
    if (!sub && st.phase === 1) {
        const e = C.block.active;
        bctx.globalAlpha = st.alpha * e.edgeOpacity;
        bctx.strokeStyle = `rgb(${e.edgeColor.map(x => Math.round(x * 255)).join(",")})`;
        bctx.lineWidth = Math.max(1, h * 0.0015);
        bctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    }

    bctx.restore();
    return true;
};

const render_blocks = (sctx, t) => {
    const blocks = C.chart.blocks;
    C.block_live = false;
    if (!C.block_enabled || !blocks || !blocks.length) return;

    const w = cv.width, h = cv.height;
    const mctx = C.block_cv.getContext("2d");
    const sctx2 = C.block_sub_cv.getContext("2d");
    // mask 画布是 /8 分辨率（原版 mask RT 就是 w/8 × h/8），先把坐标系缩到 /8，
    // 下面画方块时仍用屏幕坐标，几何计算一行都不用改。
    // clearRect 必须在缩放之前用设备坐标清，否则清的范围也跟着被缩。
    const sx = w ? C.block_cv.width / w : 1, sy = h ? C.block_cv.height / h : 1;
    for (const c of [mctx, sctx2]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
        c.clearRect(0, 0, C.block_cv.width, C.block_cv.height);
        // 同一个通道里多个块叠加要取并集（max），不能相加：相加会把重叠处顶到 1，
        // 而单块只有淡入系数那么亮，于是重叠边界上凭空多出一圈亮线，
        // 看着就是两个方块叠在一起而不是拼成一整块。
        c.globalCompositeOperation = "lighten";
        c.scale(sx, sy);
    }

    let any = false;
    for (const b of blocks) {
        const ctx2 = b.isSubtract ? sctx2 : mctx;
        if (draw_block_mask(ctx2, b, t, w, h, b.isSubtract)) any = true;
    }
    C.block_live = any;

    // 只有在 WebGL 管线真的用不了的时候才退化成纯色方块。
    // 这条路径一旦和 WebGL 同时跑，场景画布上就留了一份没处理的方块，
    // 而 WebGL 那份被位移场抖过、轮廓对不齐，看上去就是「处理过的方块叠在未处理的方块上」。
    if (any && (!C.fx_enabled || C.fx_failed)) {
        for (const b of blocks) if (!b.isSubtract) draw_block_flat(sctx, b, t, w, h, false);
        for (const b of blocks) if (b.isSubtract) draw_block_flat(sctx, b, t, w, h, true);
    }
};

/* ---------------- 后期特效 ----------------
   Glitch -> RGBShift -> VignettePlus -> ESCControl(Brightness)
   逐条照 PostEffects_*.glsl 还原，曲线来自 postfx.json（重建自 C9S6LevelEffect）。

   Glitch      : 以 glitch.png 的 R/G/B 当三通道独立噪声场，方向与幅度每帧由 _Time 推出
                 （整屏共用一组，见 glitch_dirs），把 R/G/B 各自沿方向位移 (noise-0.5)*_GlitchRange
   RGBShift    : G/B 沿径向位移，量 = pow(len*_Deform, _Radius)。
                 _Radius 是指数，越大位移越小 —— 6.5 几乎看不出，3.5 才明显，
                 所以这条曲线是「从关到开」而不是从开到关。
   VignettePlus: tex * (1 - smoothstep((len-_Radius)/_Smooth) * _Darkness)
   ESCControl  : tex * _Brightness（S6 的 Saturation/Contrast 恒为 1）

   三张图的采样在 uv 空间做（和 shader 一致），所以径向距离是各向异性的。 */

/* ---------------- 着色器：独立文件 ----------------

   全部 GLSL 都在 /shader 下，main.js 不再内嵌。启动时一次性读入，
   按 `#include "key"` 递归展开（block_disp 被 cov 与 apply 共用）。
   uv 朝向、量化网格、通道语义等实现细节都写在各自的 .glsl 里。

     fx.vert           全屏三角形
     glitch.frag       ≈ PostEffects_Glitch
     rgbshift.frag     ≈ PostEffects_RGBShift
     vignette.frag     ≈ PostEffects_VignettePlus
     esc.frag          ≈ PostEffects_ESCContol
     copy.frag         直通拷贝
     block_disp.glsl   位移场（被下面几个 include）
     block_cov.frag    ≈ Unlit/BlockCompose
     block_layers.frag ≈ Unlit/DisabledBlock（加法层，烘进场景）
     block_ring.frag   ≈ Unlit/EdgeMask + Unlit/GlowMask
     block_apply.frag  ≈ Unlit/ActiveBlock / ReadyBlock（disabled 由 block_layers 接管） */
const SHADER_FILES = {
    fx_vs:       "fx.vert",
    glitch:      "glitch.frag",
    rgbShift:    "rgbshift.frag",
    vignette:    "vignette.frag",
    esc:         "esc.frag",
    copy:        "copy.frag",
    block_disp:  "block_disp.glsl",
    // 顺序有讲究：load_shaders 按下标顺序展开 #include，block_layers 里有
    // `#include "block_disp"`，排到 block_disp 前面会抛「shader include 找不到」
    block_layers: "block_layers.frag",
    block_cov:   "block_cov.frag",
    block_ring:  "block_ring.frag",
    block_apply: "block_apply.frag"
};

const SH = {};

/* 展开 `#include "key"`；成环或找不到都直接抛错，别让 shader 悄悄缺一段。 */
const shader_expand = (src, seen) => src.replace(
    /^[ \t]*#include[ \t]+"([A-Za-z0-9_]+)"[ \t]*$/gm,
    (m, key) => {
        if (!(key in SH)) throw new Error(`shader include 找不到: ${key}`);
        if (seen.includes(key)) throw new Error(`shader include 成环: ${seen.concat(key).join(" -> ")}`);
        return shader_expand(SH[key], seen.concat(key));
    }
);

const load_shaders = async () => {
    const keys = Object.keys(SHADER_FILES);
    const texts = await Promise.all(keys.map(k => load_text(`/shader/${SHADER_FILES[k]}`)));
    keys.forEach((k, i) => { SH[k] = texts[i]; });
    for (const k of keys) SH[k] = shader_expand(SH[k], [k]);
};

const fx_compile = (gl, type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
};

const fx_program = (gl, fs_src) => {
    const p = gl.createProgram();
    gl.attachShader(p, fx_compile(gl, gl.VERTEX_SHADER, SH.fx_vs));
    gl.attachShader(p, fx_compile(gl, gl.FRAGMENT_SHADER, fs_src));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(`link: ${gl.getProgramInfoLog(p)}`);

    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
        const nm = gl.getActiveUniform(p, i).name;
        loc[nm] = gl.getUniformLocation(p, nm);
    }
    return { p, loc, a_pos: gl.getAttribLocation(p, "a_pos") };
};

/* RT 尺寸切分，照抄原版 CreateRenderTexture 的整除（HANDOFF §3.1 / §7-3）：
   /8 = mask 那几对 RT + composedEnabled/composedDisabled、/4 = effectRT + glow ping
   （反汇编里 v38 = 2*(w>>3)，就是 w/4）、/6 = sceneColorRT（apply 的 hue 源）。
   下限 1 是防窗口小于一个 RT 时分配出 0 尺寸（原版会直接创建失败）。 */
const rt_dim = (n, d) => Math.max(1, Math.floor(n / d));

const fx_init = () => {
    const canvas = document.createElement("canvas");
    const opts = {
        alpha: false, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: false, preserveDrawingBuffer: true
    };
    const gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts);
    if (!gl) return null;

    const mk_tex = (repeat, nearest) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        const filter = nearest ? gl.NEAREST : gl.LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        return t;
    };

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const F = {
        gl, canvas, vbo,
        tex: [mk_tex(), mk_tex()],
        // glitch 噪声图：Point + Repeat，对齐 Glitch4in1.png 的导入设置
        noise: mk_tex(true, true),
        /* 方块管线中间 RT 的分辨率与滤波全部照抄原版（HANDOFF §3.1、§7-3）：
             mask/sub  = w/8 Point —— 原版那几对 mask RT（0xC0/0xC8/0xD0/0xD8/0xE0/0xE8）
                         全是 w/8、R8/RG16、FilterMode 0(Point)，实际尺寸由每帧从 canvas
                         上传决定（canvas 已经是 /8，见 resize()）
             bcov      = w/8 Point —— composedEnabled/composedDisabled 同规格，
                         apply 里 covA 就是这么拿到「/8 阶梯」轮廓的
             bring     = w/4 **Bilinear** —— 原版 effectRT 是全场唯一一个 Bilinear（§8-7）
             glowA/B   = w/4 Point —— 原版 glow pingA/pingB，除滤波外与 effectRT 同规格
             scene6    = w/6 Point —— 原版 sceneColorRT（ARGB32 / Point），apply 的 hue 源 */
        mask: mk_tex(false, true), sub: mk_tex(false, true), bcov: mk_tex(false, true),
        bring: mk_tex(false, false),
        glowA: mk_tex(false, true), glowB: mk_tex(false, true),
        scene6: mk_tex(false, true),
        /* 位移图/火花图按原版贴图的导入设置采样：
           BlockNoise1.png  filterMode 0(Point) wrap 2(Repeat)
           PointNoise.png   filterMode 0(Point) wrap 0(Clamp)
           线性过滤会把 256² 的噪声抹平，方块边缘就变成平滑的扭动（扭曲），
           拿不到原版那种逐像素碎裂的边（细碎）。 */
        displace: mk_tex(true, true), spark: mk_tex(false, true),
        fbo: gl.createFramebuffer(),
        w: 0, h: 0,
        prog: {
            glitch: fx_program(gl, SH.glitch),
            rgbShift: fx_program(gl, SH.rgbShift),
            vignette: fx_program(gl, SH.vignette),
            esc: fx_program(gl, SH.esc),
            copy: fx_program(gl, SH.copy),
            bLayers: fx_program(gl, SH.block_layers),
            bCov: fx_program(gl, SH.block_cov),
            bRing: fx_program(gl, SH.block_ring),
            bApply: fx_program(gl, SH.block_apply)
        }
    };
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    return F;
};

// 绑贴图 + 把 sampler uniform 指到对应 unit
const fx_bind = (gl, unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
};

/* vp = 该 pass 要写的 RT 尺寸（不传就是全屏 F.w×F.h）。
   原版每个 pass 的 Blit 目标 RT 尺寸各不相同（/8 compose、/4 effectRT、/6 sceneColor），
   gl.viewport 必须跟着目标走，否则只会写到目标的左下角一块。 */
const fx_pass = (prog, dst_tex, setup, vp) => {
    const gl = C.fx.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst_tex ? C.fx.fbo : null);
    if (dst_tex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst_tex, 0);
    gl.viewport(0, 0, vp ? vp[0] : C.fx.w, vp ? vp[1] : C.fx.h);

    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, C.fx.vbo);
    gl.enableVertexAttribArray(prog.a_pos);
    gl.vertexAttribPointer(prog.a_pos, 2, gl.FLOAT, false, 0, 0);

    if (setup) setup(prog, gl);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
};

/* 位移参数按 pass 分开喂：合成 mask 用 BlockCompose 那一套（决定轮廓怎么抖），
   全屏上色用 ActiveBlock/DisabledBlock 那一套（只用来取场景色和火花）。
   以前两个 pass 共用 ActiveBlock 的参数，等于拿 0.8/0.3 的噪声去扯轮廓，
   噪声被纵向拉长、幅度又放大 1.5 倍，方块就不是「边缘破碎」而是整块扭曲了。
   （§7-6 从 fx_blocks 内部闭包提到模块层：bLayers / bCov / bApply 三趟都要用。）
   strength = 该趟的 _DisplaceStrength；tx = t/20（Unity 的 _Time.x）由调用方传，
   因为 layers 那趟同样需要正确的时间相位。
   某趟 shader 没声明的 uniform（block_layers 没有 u_strength/u_stA/u_spA）location
   为 undefined，WebGL 静默忽略，不用特判。 */
const fx_disp_uniforms = (p, gl, A, D, strength, tx) => {
    const B = C.block;
    const F = C.fx;
    const dir = B.displaceDir;
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    fx_bind(gl, 3, F.displace, p.loc.u_disp);
    // u_res 恒为**屏幕全分辨率**：block_disp 的网格量化是按 _ScreenParams（屏幕像素）
    // 算的，mask/compose 现在是 /8，但量化格子不能跟着除以 8（HANDOFF §7-3）。
    gl.uniform2f(p.loc.u_res, F.w, F.h);
    gl.uniform2f(p.loc.u_dir, dir[0] / dl, dir[1] / dl);
    gl.uniform1f(p.loc.u_ps, B.pixelScale);
    gl.uniform1f(p.loc.u_strength, strength);
    gl.uniform1f(p.loc.u_tx, tx);
    gl.uniform2f(p.loc.u_stA, A.displaceST[0], A.displaceST[1]);
    gl.uniform1f(p.loc.u_spA, A.displaceSpeed);
    gl.uniform2f(p.loc.u_stD, D.displaceST[0], D.displaceST[1]);
    gl.uniform1f(p.loc.u_spD, D.displaceSpeed);
};

/* §7-6：mask 上传 + compose → bcov（/8 Point）。layers 与 ring 都吃 bcov，
   所以这趟必须先跑；由 fx_render 的 block 分支编排顺序。 */
const fx_cov = t => {
    const F = C.fx;
    const gl = F.gl;
    const B = C.block;
    const vp8 = [rt_dim(F.w, 8), rt_dim(F.h, 8)];

    gl.bindTexture(gl.TEXTURE_2D, F.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, C.block_cv);
    gl.bindTexture(gl.TEXTURE_2D, F.sub);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, C.block_sub_cv);

    fx_pass(F.prog.bCov, F.bcov, p => {
        fx_bind(gl, 0, F.mask, p.loc.u_mask);
        fx_bind(gl, 1, F.sub, p.loc.u_sub);
        fx_disp_uniforms(p, gl, B.compose, B.compose, B.compose.displaceStrength, t / 20);
    }, vp8);
};

/* 方块管线后半段：ring（描边/辉光）-> apply（上色到场景）。
   mask 上传与 compose 已抽成 fx_cov()；disabled 加法层由 fx_render 里的 bLayers 趟跑。 */
const fx_blocks = (t, cur_tex, dst_tex) => {
    const F = C.fx;
    const gl = F.gl;
    const B = C.block;
    const w = F.w, h = F.h;
    // ring 趟写 /4（原版 effectRT）
    const vp4 = [rt_dim(w, 4), rt_dim(h, 4)];
    const tx = t / 20;   // Unity 的 _Time.x

    const common = p => fx_disp_uniforms(p, gl, B.active, B.disabled, B.displaceStrength, tx);

    /* ---- ring（原版 RenderEffects：clear → edge → glow 多趟 → 拷进 effectRT）----
       顺序调成「先 glow ping-pong、最后合成趟」：edge 与 glow 写的是 effectRT 的不同
       通道（R / G，§8-1 裁决），先谁后谁结果完全一样，而合成趟必须放在最后写 bring，
       才能同时拿到 edge 和 glow —— 也避开了「写 bring 又采样 bring」的 FBO 回读。 */
    const texel = [1 / vp4[0], 1 / vp4[1]];

    // 原版在循环前先清 pingA/pingB：.y 要有 0 的基线（一趟没跑时 G 就是 0）
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.fbo);
    gl.viewport(0, 0, vp4[0], vp4[1]);
    gl.clearColor(0, 0, 0, 0);
    for (const tex of [F.glowA, F.glowB]) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 权重分母 = Σ_{k=1..R} pow(k, f)，与反汇编 GetGlowRingWeight 的 do-while 一致
    const GR = B.glowRadius, GF = B.glowFalloff, GT = B.glowThreshold;
    let den = 0;
    for (let k = 1; k <= GR; k++) den += Math.pow(k, GF);

    let ping = null;
    for (let i = 0; i < GR; i++) {
        const wi = Math.pow(GR - i, GF) / den;
        if (wi < GT) break;                 // w_{next} < threshold ⇒ 出循环
        const dst = !ping ? F.glowA : (ping === F.glowA ? F.glowB : F.glowA);
        const src = !ping ? F.bcov : ping;   // 首趟的 _MainTex 就是 compose 本身
        fx_pass(F.prog.bRing, dst, p => {
            fx_bind(gl, 0, F.bcov, p.loc.u_cov);
            fx_bind(gl, 1, src, p.loc.u_main);
            gl.uniform2f(p.loc.u_texel, texel[0], texel[1]);
            gl.uniform1f(p.loc.u_mode, 1);
            gl.uniform1f(p.loc.u_weight, wi);
            gl.uniform1f(p.loc.u_first, i === 0 ? 1 : 0);   // _GlowFirstPass 只在首趟为 1
        }, vp4);
        ping = dst;
    }

    // 合成趟：R = edge（dilate9(compose) − compose）、G = ping 的 .y（辉光累积）
    const glowTex = ping || F.glowA;
    fx_pass(F.prog.bRing, F.bring, p => {
        fx_bind(gl, 0, F.bcov, p.loc.u_cov);
        fx_bind(gl, 1, glowTex, p.loc.u_main);
        gl.uniform2f(p.loc.u_texel, texel[0], texel[1]);
        gl.uniform1f(p.loc.u_mode, 0);
    }, vp4);

    fx_pass(F.prog.bApply, dst_tex, p => {
        const A = B.active, R = B.ready;
        fx_bind(gl, 0, cur_tex, p.loc.u_src);
        fx_bind(gl, 1, F.bcov, p.loc.u_cov);
        fx_bind(gl, 2, F.bring, p.loc.u_ring);
        fx_bind(gl, 4, F.spark, p.loc.u_spark);
        // hue 源 = /6 Point 快照（原版 sceneColorRT），已含 layers 烘进去的 disabled 层
        fx_bind(gl, 5, F.scene6, p.loc.u_scene6);
        common(p);
        // eA 格心 snap 的格子 = bring 的实际尺寸（原版 _EffectRT_TexelSize），别拿 u_res/4 代
        gl.uniform2f(p.loc.u_ringRes, vp4[0], vp4[1]);
        gl.uniform1f(p.loc.u_ty, t);
        gl.uniform3f(p.loc.u_fillA, A.fillColor[0], A.fillColor[1], A.fillColor[2]);
        gl.uniform1f(p.loc.u_fillOpA, A.fillOpacity);
        gl.uniform1f(p.loc.u_fillStrA, A.fillStrength);
        gl.uniform3f(p.loc.u_edgeA, A.edgeColor[0], A.edgeColor[1], A.edgeColor[2]);
        gl.uniform1f(p.loc.u_edgeOpA, A.edgeOpacity);
        gl.uniform3f(p.loc.u_glowA, A.glowColor[0], A.glowColor[1], A.glowColor[2]);
        gl.uniform1f(p.loc.u_glowIntA, A.glowIntensity);
        gl.uniform3f(p.loc.u_tintA, A.sparkTint[0], A.sparkTint[1], A.sparkTint[2]);
        gl.uniform1f(p.loc.u_sparkOpA, A.sparkOpacity);
        gl.uniform1f(p.loc.u_sparkDispA, A.sparkDisplace);
        gl.uniform1f(p.loc.u_hueA, A.sparkHueShift);
        gl.uniform2f(p.loc.u_sparkSTA, A.sparkST[0], A.sparkST[1]);
        gl.uniform1f(p.loc.u_dispBlendA, A.displaceBlend);
        // disabled 的填色/火花 uniform 已移到 bLayers 趟（§7-6），apply 不再画 disabled
        gl.uniform3f(p.loc.u_shineCol, R.shineColor[0], R.shineColor[1], R.shineColor[2]);
        gl.uniform1f(p.loc.u_shineBright, R.shineBrightness);
        gl.uniform1f(p.loc.u_shineSpeed, R.shineSpeed);
    });
};

/* 原版 Glitch 的三个位移方向与幅度全在顶点着色器里由 _Time/_CosTime 算出，与顶点位置无关，
   所以整屏共用同一组向量、每帧缓慢变化，而不是逐帧随机。逐行照抄 PostEffects_Glitch.glsl
   的顶点部分：先 fract(k*t+o) 取小数，再 (v+大常数)*(v+小常数) 平方后 fract 得到 [0,1) 伪随机；
   前两组各取两维归一化成 2D 方向（乘 _CosTime.w = cos t，只影响正负号），第三组直接当幅度。
   返回的每个 vec3 = (方向 x, 方向 y, 幅度)，直接喂给 u_dirA/B/C。 */
const glitch_dirs = t => {
    const fr = x => x - Math.floor(x);
    const hash = (v, big, small) => { const m = (v + big) * (v + small); return fr(m * m); };
    const dir2 = (x, y) => {
        const ct = Math.cos(t);
        const l = Math.hypot(x * ct, y * ct);
        return l > 1e-9 ? [(x * ct) / l, (y * ct) / l] : [0, 0];
    };
    const pair = (v0, v1) =>
        dir2(hash(v0, 33.5540237, 0.224023432), hash(v1, 33.80439, 0.474389642));

    const a0 = fr(0.1031 * t + 0.546), a1 = fr(0.1031 * t + 0.153);
    const a2 = fr(0.2062 * t + 0.546), a3 = fr(0.2062 * t + 0.153);
    const c0 = fr(0.3093 * t + 0.546), c1 = fr(0.3093 * t + 0.153);
    const c2 = fr(0.1031 * t + 0.1919), c3 = fr(0.2062 * t + 0.81);
    const r = fr(0.3093 * t + 0.1145);

    const A = pair(a0, a1), B = pair(a2, a3), C = pair(c0, c1);
    return {
        A: [A[0], A[1], hash(c2, 33.4939346, 0.16393432)],
        B: [B[0], B[1], hash(c3, 34.2789078, 0.948907495)],
        C: [C[0], C[1], hash(r, 34.0607834, 0.730783105)]
    };
};

const fx_render = (src_canvas, t) => {
    const F = C.fx;
    const gl = F.gl;
    const pf = C.postfx;
    const K = pf ? pf.curves : null;

    gl.bindTexture(gl.TEXTURE_2D, F.tex[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src_canvas);

    let cur = 0;
    const run = (prog, setup) => {
        fx_pass(prog, F.tex[1 - cur], setup);
        cur = 1 - cur;
    };

    // 方块先压进场景，后期特效再作用于整张画面。
    // 顺序有讲究（HANDOFF §10.1）：
    //   ① fx_cov        compose → bcov（layers 和 ring 都吃它）
    //   ② bLayers       scene += covG×fillD，写另一张 tex 以免读写同一张
    //   ③ copy → scene6 /6 Point 快照 = apply 的 hue 源，必须在 layers 之后（含 disabled 层）
    //   ④ fx_blocks     ring + apply（apply 的 u_src 也取含 layers 的这一张）
    if (C.block_live) {
        const tx = t / 20;
        const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];   // 必须与 apply_postfx 的 set(scene6) 同表达式
        const D = C.block.disabled;

        fx_cov(t);

        fx_pass(F.prog.bLayers, F.tex[1 - cur], p => {
            fx_bind(gl, 0, F.tex[cur], p.loc.u_src);
            fx_bind(gl, 1, F.bcov, p.loc.u_cov);
            fx_bind(gl, 4, F.spark, p.loc.u_spark);
            // layers 无位移强度（DisabledBlock 场景色不位移），snap=0 见 block_layers.frag
            fx_disp_uniforms(p, gl, D, D, 0, tx);
            gl.uniform3f(p.loc.u_fillD, D.fillColor[0], D.fillColor[1], D.fillColor[2]);
            gl.uniform1f(p.loc.u_fillOpD, D.fillOpacity);
            gl.uniform3f(p.loc.u_tintD, D.sparkTint[0], D.sparkTint[1], D.sparkTint[2]);
            gl.uniform1f(p.loc.u_sparkOpD, D.sparkOpacity);
            gl.uniform1f(p.loc.u_sparkDispD, D.sparkDisplace);
            gl.uniform2f(p.loc.u_sparkSTD, D.sparkST[0], D.sparkST[1]);
        });
        cur = 1 - cur;

        fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);

        fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
        cur = 1 - cur;
    }

    if (!pf) {
        fx_pass(F.prog.copy, null, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src));
        return;
    }

    const gr = curve_val(K.glitchRange, t);
    const gd = glitch_dirs(t);
    run(F.prog.glitch, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.noise, p.loc.u_noise);
        g.uniform1f(p.loc.u_range, gr);
        g.uniform3f(p.loc.u_dirA, gd.A[0], gd.A[1], gd.A[2]);
        g.uniform3f(p.loc.u_dirB, gd.B[0], gd.B[1], gd.B[2]);
        g.uniform3f(p.loc.u_dirC, gd.C[0], gd.C[1], gd.C[2]);
    });

    const cc = pf._constants || {};
    run(F.prog.rgbShift, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform1f(p.loc.u_radius, curve_val(K.rgbShiftRadius, t));
        g.uniform1f(p.loc.u_deform, curve_val(K.rgbShiftDeform, t));
        g.uniform2f(p.loc.u_center, cc.rgbShiftCenter[0], cc.rgbShiftCenter[1]);
    });

    run(F.prog.vignette, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform1f(p.loc.u_radius, curve_val(K.vignetteRadius, t));
        g.uniform1f(p.loc.u_smooth, curve_val(K.vignetteSmoothness, t));
        g.uniform1f(p.loc.u_darkness, curve_val(K.vignetteDarkness, t));
        g.uniform2f(p.loc.u_center, cc.vignetteCenter[0], cc.vignetteCenter[1]);
    });

    run(F.prog.esc, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform1f(p.loc.u_brightness, curve_val(K.brightness, t));
        g.uniform1f(p.loc.u_saturation, cc.saturation);
        g.uniform1f(p.loc.u_contrast, cc.contrast);
        g.uniform3f(p.loc.u_average, 0, 0, 0);
    });

    fx_pass(F.prog.copy, null, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src));
};

const apply_postfx = (src, dst, t) => {
    const dctx = dst.getContext("2d");
    const w = dst.width, h = dst.height;

    // 视口可能瞬时为 0（隐藏 / 最小化）。这时候不能往下走：GL canvas 会被缩到 0x0，
    // 之后 drawImage 直接抛 InvalidStateError。
    if (!w || !h) return;

    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalAlpha = 1;
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, w, h);

    if (!C.fx_enabled || C.fx_failed) {
        dctx.drawImage(src, 0, 0);
        return;
    }

    if (!C.fx) {
        try {
            C.fx = fx_init();
        } catch (e) {
            C.fx = null;
            console.error("WebGL 管线初始化失败，退回原图：", e);
        }
        if (!C.fx) {
            C.fx_failed = true;
            dctx.drawImage(src, 0, 0);
            return;
        }
        const gl = C.fx.gl;
        if (C.glitch_img) {
            gl.bindTexture(gl.TEXTURE_2D, C.fx.noise);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, C.glitch_img);
        }
        const dtex = C.block.imgs.displace, stex = C.block.imgs.spark;
        if (dtex) {
            gl.bindTexture(gl.TEXTURE_2D, C.fx.displace);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dtex);
        }
        if (stex) {
            gl.bindTexture(gl.TEXTURE_2D, C.fx.spark);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stex);
        }
    }

    const gl = C.fx.gl;
    if (C.fx.w !== w || C.fx.h !== h) {
        C.fx.w = w;
        C.fx.h = h;
        C.fx.canvas.width = w;
        C.fx.canvas.height = h;
        // 中间 RT 按各自分辨率重建（mask/sub 由 canvas 上传决定，不在这儿管）。
        // 窗口一改尺寸这些全要重分，否则 viewport 和纹理尺寸对不上 → 花屏/黑屏。
        const set = (tex, tw, th) => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        };
        set(C.fx.tex[0], w, h);
        set(C.fx.tex[1], w, h);
        set(C.fx.bcov, rt_dim(w, 8), rt_dim(h, 8));
        set(C.fx.bring, rt_dim(w, 4), rt_dim(h, 4));
        set(C.fx.glowA, rt_dim(w, 4), rt_dim(h, 4));
        set(C.fx.glowB, rt_dim(w, 4), rt_dim(h, 4));
        set(C.fx.scene6, rt_dim(w, 6), rt_dim(h, 6));
    }

    fx_render(src, t);
    dctx.drawImage(C.fx.canvas, 0, 0);
};

/* ---------------- 主渲染 ---------------- */

const render_scene = (sctx, t) => {
    const [w, h] = [cv.width, cv.height];
    const note_width = w * 0.1234375;

    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(C.chart.image, 0, 0, w, h);
    sctx.fillRectEx(0, 0, w, h, "rgba(0, 0, 0, 0.6)");

    for (const line of C.chart.data.judgeLineList) {
        let [lineRotate, lineX, lineY, lineAlpha] = line.get_state(t);
        lineX *= w; lineY *= h;
        const lineDrawPos = [
            ...rotate_point(lineX, lineY, h * C.lineh, lineRotate),
            ...rotate_point(lineX, lineY, h * C.lineh, lineRotate + 180)
        ];

        sctx.drawLine(...lineDrawPos, h * C.linew, `rgba(${C.pcolor.join(", ")}, ${lineAlpha})`);
        const beatt = line.sec2beat(t);
        const linefp = get_fp(beatt, line.speedEvents);

        for (const note of line.notes) {
            if (note.sect < t && !note.clicked) {
                play_sound(C.click_sounds[note.type]);
                note.clicked = true;
            }

            if ((!note.is_hold && note.sect < t) || (note.is_hold && note.hold_end_time < t)) {
                continue;
            }

            // 可见性判定：游戏 NoteUpdateManager.Update 每帧对每个 note 的顺序是
            //   ① if (note.realTime < nowTime) goto 判定分支;        ← ★先判，note 已到点就走判定
            //   ② dist = note.floorPosition - linefp                  （★还没乘 note.speed）
            //      if (dist < -max(note.floorPosition/6e6, 0.001)) 跳过;
            // 也就是说 dist 那条**只在 note 还没到点时生效**。到点之后（hold 被点中、正在
            // 拉伸/回收 hold 体）走的是判定分支，hold 体必须继续画 —— 别在这里把 hold 体剔掉。
            // 「跳过」= 不定位、不画、不判定，note 对象永远停在创建时的 position=(1000,0,0)
            // 那个停放位上（CreateNote 里四种 type 都这么初始化），所以等于不可见。
            // 负流速（judgeLineSpeedEvent.value<0）时 linefp 往回走，dist 会在 note 自己到点
            // **之前**就变负 ⇒ 原版不显示，我们原先只判 < -1e6 所以把它画出来了。
            const dist = note.floorPosition - linefp;
            if (note.sect >= t && dist < -Math.max(note.floorPosition / 6000000, 0.001)) continue;

            let note_fp = dist * C.units.pgrh * (C.units.pgrbeat / line.bpm) * h;

            if (!note.is_hold) note_fp *= note.speed;
            if (!note.is_hold && note_fp < -1e6) continue;
            if (note_fp > h * 2) continue;

            const draw_head = note.sect > t;
            const note_head_img = C.note_head_imgs[note.type][note.morebets];
            const this_note_width = note_width * (note.morebets ? (
                C.note_head_imgs[note.type][1].width
                / C.note_head_imgs[note.type][0].width
            ) : 1.0);

            const this_note_head_height = this_note_width / note_head_img.width * note_head_img.height;
            const note_atline_pos = rotate_point(lineX, lineY, note.positionX * C.units.pgrw * w, lineRotate);
            const l2n_rotate = lineRotate - (note.is_above ? 90 : -90);
            const note_head_pos = rotate_point(...note_atline_pos, note_fp, l2n_rotate);

            const note_draw_rotate = lineRotate + (note.is_above ? 0 : 180);

            if (draw_head) {
                sctx.drawCenterRotateImage(
                    note_head_img, ...note_head_pos,
                    this_note_width, this_note_head_height,
                    note_draw_rotate
                );
            }

            if (note.is_hold) {
                const note_body_img = C.hold_body_imgs[note.morebets];
                const note_tail_img = C.hold_tail_imgs[note.morebets];
                const note_tail_height = this_note_width / note_tail_img.width * note_tail_img.height;

                const note_body_height = Math.max(
                    note.hold_length * h
                    + Math.min(0, note_fp)
                    + (note.clicked ? this_note_head_height / 2 : 0)
                    - note_tail_height / 2
                    , 0
                );

                const note_body_pos = rotate_point(
                    ...((!note.clicked) ? note_head_pos : note_atline_pos),
                    ((!note.clicked) ? this_note_head_height / 2 : 0) + note_body_height / 2,
                    l2n_rotate);

                sctx.drawCenterRotateImage(
                    note_body_img, ...note_body_pos,
                    this_note_width, note_body_height,
                    note_draw_rotate
                );

                const note_tail_pos = rotate_point(
                    ...note_body_pos,
                    note_body_height / 2 + note_tail_height / 2,
                    l2n_rotate
                );

                sctx.drawCenterRotateImage(
                    note_tail_img, ...note_tail_pos,
                    this_note_width, note_tail_height,
                    note_draw_rotate
                );
            }
        }
    }

    const effect_dur = 0.5;

    for (const [note, effect_t] of C.chart.data.click_effect_collection) {
        if (effect_t > t) break;
        if (effect_t + effect_dur < t) continue;

        const p = (t - effect_t) / effect_dur;
        const imi = Math.max(0, Math.min(C.hit_fx_imgs.length - 1, Math.floor(p * C.hit_fx_imgs.length)));
        const im = C.hit_fx_imgs[imi];
        const effect_size = note_width * 1.375 * 1.12;
        const [pars, pos_getter] = note.get_click_effect(w, h);
        const [x, y] = pos_getter(effect_t);

        sctx.save();
        sctx.globalAlpha *= C.palpha;
        sctx.drawImage(
            im,
            x - effect_size / 2, y - effect_size / 2,
            effect_size, effect_size
        );
        sctx.restore();

        for (const paritem of pars) {
            const [rotate, size, r] = paritem(p);
            sctx.save();
            sctx.translate(x, y);
            const parcenter = rotate_point(0, 0, r, rotate);
            sctx.fillRectEx(parcenter[0], parcenter[1], size, size, `rgba(${C.pcolor.join(", ")}, ${1.0 - p})`);
            sctx.restore();
        }
    }

    render_blocks(sctx, t);
};

const render = () => {
    const t = get_time() - C.chart.data.offset;
    // rAF 必须无条件续上：以前它排在最后，一帧抛异常整条渲染循环就死了，画面永远黑屏
    try {
        if (cv.width && cv.height) {
            render_scene(C.scene_cv.getContext("2d"), t);
            apply_postfx(C.scene_cv, cv, t);
            update_progress(t);
        }
    } catch (e) {
        console.error("渲染帧出错（已跳过该帧）：", e);
    }
    requestAnimationFrame(render);
};

CanvasRenderingContext2D.prototype.drawLine = function (x0, y0, x1, y1, w, c) {
    this.save();
    this.beginPath();
    this.moveTo(x0, y0);
    this.lineTo(x1, y1);
    this.lineWidth = w;
    this.strokeStyle = c;
    this.stroke();
    this.restore();
};

CanvasRenderingContext2D.prototype.fillRectEx = function (x, y, w, h, c) {
    this.save();
    this.beginPath();
    this.rect(x, y, w, h);
    this.fillStyle = c;
    this.fill();
    this.restore();
};

CanvasRenderingContext2D.prototype.drawCenterRotateImage = function (img, x, y, w, h, deg) {
    this.save();
    this.translate(x, y);
    this.rotate(deg * Math.PI / 180);
    this.drawImage(img, -w / 2, -h / 2, w, h);
    this.restore();
};

/* ---------------- 谱面装载 ---------------- */

const init_chart = () => {
    const data = C.chart.data;
    const note_sect_counter = new Map();

    for (const line of data.judgeLineList) {
        line.speedEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineRotateEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineMoveEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineDisappearEvents.sort((a, b) => a.startTime - b.startTime);

        line.sec2beat = function (t) { return t / (C.units.pgrbeat / this.bpm); };
        line.beat2sec = function (t) { return t * (C.units.pgrbeat / this.bpm); };
        line.get_state = function (t) {
            const beatt = this.sec2beat(t);
            const rotate = get_event_val(beatt, this.judgeLineRotateEvents, "start", "end") * -1;
            const x = get_event_val(beatt, this.judgeLineMoveEvents, "start", "end");
            const y = 1.0 - get_event_val(beatt, this.judgeLineMoveEvents, "start2", "end2");
            const alpha = get_event_val(beatt, this.judgeLineDisappearEvents, "start", "end");
            return [rotate, x, y, alpha];
        };

        init_speed_events(line.speedEvents);
        line.notes = merge_notes(line.notesAbove, line.notesBelow);
        init_note_fp(line.notes, line.speedEvents);

        for (const note of line.notes) {
            note.sect = line.beat2sec(note.time);
            note.secht = line.beat2sec(note.holdTime);
            note.hold_end_time = note.sect + note.secht;
            note.hold_length = note.secht * note.speed * C.units.pgrh;
            note.is_hold = note.type === C.note.hold;
            note.clicked = false;
            note.master = line;

            if (!note_sect_counter.has(note.sect)) note_sect_counter.set(note.sect, 0);
            note_sect_counter.set(note.sect, note_sect_counter.get(note.sect) + 1);
        }

        delete line.notesAbove;
        delete line.notesBelow;
    }

    for (const line of data.judgeLineList) {
        for (const note of line.notes) {
            note.morebets = +(note_sect_counter.get(note.sect) > 1);
        }
    }

    data.click_effect_collection = [];

    for (const line of data.judgeLineList) {
        for (const note of line.notes) {
            note.get_click_effect = function (w, h) {
                const pars = new Array(4).fill(0).map(() => {
                    const rotate = Math.random() * 360;
                    const s = w / 4040 * 3;
                    const size = s * 33 * 0.75;
                    const r = s * (Math.random() * (265 - 185) + 185);
                    return p => [rotate, size, r * (9 * p / (8 * p + 1))];
                });
                this.get_click_effect = () => [pars, t => {
                    let [lineRotate, lineX, lineY, _] = line.get_state(t);
                    return rotate_point(lineX * w, lineY * h, this.positionX * C.units.pgrw * w, lineRotate);
                }];
                return this.get_click_effect();
            };

            data.click_effect_collection.push([note, note.sect]);

            if (note.is_hold) {
                const dt = 30 / line.bpm;
                let st = note.sect + dt;
                while (st < note.hold_end_time) {
                    data.click_effect_collection.push([note, st]);
                    st += dt;
                }
            }
        }
    }

    data.click_effect_collection.sort((a, b) => a[1] - b[1]);

    // 方块
    C.chart.blocks = (data.blockAreaList || []).map(b => {
        const bl = b.bottomLeftPercentage, tr = b.topRightPercentage;
        const x0 = Math.min(bl.x, tr.x), x1 = Math.max(bl.x, tr.x);
        const y0 = Math.min(bl.y, tr.y), y1 = Math.max(bl.y, tr.y);
        const sort_ev = k => (b[k] || []).slice().sort((a, c) => a.time - c.time);
        return {
            ...b,
            center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
            size: { x: x1 - x0, y: y1 - y0 },
            moveEvents: sort_ev("moveEvents"),
            scaleEvents: sort_ev("scaleEvents"),
            rotateEvents: sort_ev("rotateEvents")
        };
    }).filter(b => b.size.x > 1e-6 && b.size.y > 1e-6);

    let dur = C.chart.music.duration || 0;
    for (const b of C.chart.blocks) dur = Math.max(dur, b.disappearTime);
    for (const line of data.judgeLineList) {
        for (const note of line.notes) dur = Math.max(dur, note.hold_end_time);
    }
    C.chart.duration = dur;

    clock_seek(0);
    draw_progress_marks();
    update_progress(0);
};

// 同一首歌的各难度共用一份曲绘+音乐（res/library/<song>/ 下共享，
// 见 _migrate_library.py / import_library.py），所以切难度时：
//   - 曲绘 URL 不变 -> <img> 直接命中浏览器缓存；
//   - 音频可以整个复用同一个 <audio> 元素（同一个已解码缓冲），不用重新下载/解码。
// asset_cache 记住最近一次 asset 目录及其已解码资源；assetDir 相同就直接复用。
let asset_cache = { dir: null, image: null, music: null };

const music_ended = () => {
    const m = C.chart.music;
    clock.base = m ? m.duration : 0;
    clock.perf = performance.now();
};

const load_chart = async (dir, assetDir) => {
    // dir = 谱面目录（chart.json / info.json）；adir = 共享资源目录（曲绘 / 音乐 / postfx）
    const adir = assetDir || dir;
    const reuse = asset_cache.dir === adir;

    const progress = { info: 0, chart: 0, image: 0, music: 0 };
    const update = () => {
        const keys = ["info", "chart", "image", "music"];
        const sum = keys.reduce((a, k) => a + progress[k], 0);
        const pct = sum / keys.length;
        ui.loading_fill.style.width = `${Math.min(100, pct * 100)}%`;
        ui.loading_text.textContent = `${Math.round(pct * 100)}%`;
    };
    ui.loading_overlay.classList.remove("hidden");
    update();

    const info = await load_json(`${dir}/info.json`);
    progress.info = 1; update();

    const data = await load_json(`${dir}/chart.json`);
    progress.chart = 1; update();

    let image, music;
    if (reuse) {
        // 同一首歌换难度：只有曲绘+音乐是共享的重资源，直接复用（不再下载/解码）
        image = asset_cache.image;
        music = asset_cache.music;
        progress.image = 1; progress.music = 1; update();
    } else {
        image = get_blur_img(await load_img(`${adir}/image.png`), 0.05);
        progress.image = 1; update();

        music = await load_audioele(`${adir}/${info.music || "music.ogg"}`, (got, tot) => {
            progress.music = tot > 0 ? got / tot : 0;
            update();
        });
        asset_cache.image = image;
        asset_cache.music = music;
        asset_cache.dir = adir;
    }

    // postfx / glitchTex 是**每难度**的（<song>/<DIFF>/postfx.json），不参与共享缓存，
    // 也不跟曲绘音乐一起从 adir 读 —— 读错目录会 404。
    const postfx = await load_json_or_null(`${dir}/postfx.json`);
    const glitch_img = postfx && postfx.glitchTex
        ? await load_img(`${dir}/${postfx.glitchTex}`)
        : null;

    if (C.chart.music && C.chart.music !== music) {
        C.chart.music.pause();
        C.chart.music.remove();
    }
    if (music) {
        // 复用同一个 <audio> 要归零；换歌时是新元素，同样归零
        music.pause();
        try { music.currentTime = 0; } catch (e) { /* 尚未 ready 时忽略 */ }
        music.style.display = "none";
        if (!music.isConnected) document.body.appendChild(music);
        // 固定 handler + 先摘后挂，切难度时不会重复注册
        music.removeEventListener("ended", music_ended);
        music.addEventListener("ended", music_ended);
    }

    C.chart = { info, data, image, music, postfx, dir, assetDir: adir, blocks: [] };
    C.postfx = postfx;
    C.glitch_img = glitch_img;
    C.chart.music = music;

    init_chart();
    clock_run(false);
    ui.btn_play.textContent = ">";
    ui.loading_overlay.classList.add("hidden");
};

/* ---------------- HUD ---------------- */

const fmt_time = v => {
    if (!isFinite(v) || v < 0) v = 0;
    return `${v.toFixed(2)}`;
};

const update_progress = t => {
    const dur = C.chart.duration || 1;
    ui.progress_fill.style.width = `${Math.max(0, Math.min(1, t / dur)) * 100}%`;
    ui.time_label.textContent = `${fmt_time(t)} / ${fmt_time(dur)}`;
};

const draw_progress_marks = () => {
    const dur = C.chart.duration || 1;
    const times = [];
    for (const b of C.chart.blocks) {
        times.push(b.appearTime);
        times.push(b.disappearTime);
    }
    if (C.postfx && C.postfx.curves.glitchRange) {
        times.push(C.postfx.curves.glitchRange[0][0]);
        times.push(C.postfx.curves.brightness[C.postfx.curves.brightness.length - 1][0]);
    }
    const uniq = [...new Set(times)].sort((a, b) => a - b);
    ui.progress_marks.innerHTML = "";
    for (const v of uniq) {
        const i = document.createElement("i");
        i.style.left = `${Math.max(0, Math.min(1, v / dur)) * 100}%`;
        ui.progress_marks.appendChild(i);
    }
};

const reset_notes = () => {
    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) note.clicked = false;
    }
};

const play = () => {
    const m = C.chart.music;
    const t = clock_t();
    if (t < m.duration) {
        m.currentTime = Math.max(0, t);
        m.play().catch(() => {});
    }
    clock_seek(t);
    clock_run(true);
    ui.btn_play.textContent = "||";
};

const pause = () => {
    if (!C.chart.music) return;
    const t = get_time();
    C.chart.music.pause();
    clock_run(false);
    clock_seek(t);
    ui.btn_play.textContent = ">";
};

const toggle_play = () => {
    if (clock.running || !C.chart.music.paused) pause();
    else play();
};

const seek = v => {
    const m = C.chart.music;
    v = Math.max(0, Math.min(C.chart.duration, v));
    if (!m.paused && !m.ended) m.currentTime = Math.min(v, m.duration);
    clock_seek(v);
    reset_notes();
    update_progress(v);
};

/* ---------------- 谱面库 ---------------- */
let chart_started = false;
let render_started = false;
let lib_loading = false;

const library_open = () => !ui.library_overlay.classList.contains("hidden");

const open_library = () => {
    if (library_open() || lib_loading) return;
    pause();
    ui.start_overlay.classList.add("hidden");
    ui.library_overlay.classList.remove("hidden");
};

const close_library = () => {
    if (!library_open()) return;
    ui.library_overlay.classList.add("hidden");
    if (!chart_started) ui.start_overlay.classList.remove("hidden");
};

const render_library = list => {
    ui.library_count.textContent = `${list.length} charts`;
    ui.library_grid.textContent = "";
    for (const e of list) {
        const card = document.createElement("div");
        card.className = "lib-card";

        const img = document.createElement("img");
        img.className = "lib-cover";
        img.loading = "lazy";
        // 同一首歌各难度曲绘共用同一个 URL -> 浏览器只下载一次，多张卡片共用缓存
        img.src = e.cover || `${e.path}/image.png`;

        const body = document.createElement("div");
        body.className = "lib-body";

        const name = document.createElement("div");
        name.className = "lib-name";
        name.textContent = e.name;

        const sub = document.createElement("div");
        sub.className = "lib-sub";
        sub.textContent = e.composer || e.song || "";

        const row = document.createElement("div");
        row.className = "lib-row";
        const diff = document.createElement("span");
        diff.className = `lib-diff d-${e.difficulty}`;
        diff.textContent = e.difficulty;
        const level = document.createElement("span");
        level.className = "lib-level";
        level.textContent = e.level;
        row.append(diff, level);

        body.append(name, sub, row);
        card.append(img, body);
        card.onclick = () => select_chart(e);
        ui.library_grid.appendChild(card);
    }
};

const select_chart = async e => {
    if (lib_loading) return;
    lib_loading = true;
    ui.library_overlay.classList.add("hidden");
    ui.start_overlay.classList.add("hidden");
    try {
        await load_chart(e.path, e.asset || e.path);
        chart_started = false;
        ui.start_overlay.classList.remove("hidden");
    } catch (err) {
        console.error("谱面载入失败：", e.path, err);
        ui.start_overlay.classList.remove("hidden");
    }
    lib_loading = false;
};

window.onload = async () => {
    C.scene_cv = document.createElement("canvas");
    C.block_cv = document.createElement("canvas");
    C.block_sub_cv = document.createElement("canvas");

    const resize = () => {
        cv.width = window.innerWidth;
        cv.height = window.innerHeight;
        C.scene_cv.width = cv.width;
        C.scene_cv.height = cv.height;
        // 方块 mask 按原版 RT 尺寸 w/8 × h/8 光栅化（HANDOFF §3.1：那几对 mask RT 全是
        // w/8、Point，compose 也跑在 /8 上）。>> 3 就是原版 Start 里的 v31>>3 / v32>>3。
        C.block_cv.width = Math.max(1, cv.width >> 3);
        C.block_cv.height = Math.max(1, cv.height >> 3);
        C.block_sub_cv.width = C.block_cv.width;
        C.block_sub_cv.height = C.block_cv.height;
    };
    resize();
    window.onresize = resize;

    C.click_sounds[C.note.tap] = await load_audio("/res/click.ogg");
    C.click_sounds[C.note.hold] = C.click_sounds[C.note.tap];
    C.click_sounds[C.note.drag] = await load_audio("/res/drag.ogg");
    C.click_sounds[C.note.flick] = await load_audio("/res/flick.ogg");

    C.note_imgs.click = await load_img("/res/click.png");
    C.note_imgs.drag = await load_img("/res/drag.png");
    C.note_imgs.hold = await load_img("/res/hold.png");
    C.note_imgs.flick = await load_img("/res/flick.png");

    C.note_imgs.click_mh = await load_img("/res/click_mh.png");
    C.note_imgs.drag_mh = await load_img("/res/drag_mh.png");
    C.note_imgs.hold_mh = await load_img("/res/hold_mh.png");
    C.note_imgs.flick_mh = await load_img("/res/flick_mh.png");

    C.respack_info = await load_json("/res/respack.json");

    [C.note_imgs.hold_head, C.note_imgs.hold_body, C.note_imgs.hold_tail] =
        clip_hold(C.note_imgs.hold, C.respack_info.holdAtlas);
    [C.note_imgs.hold_mh_head, C.note_imgs.hold_mh_body, C.note_imgs.hold_mh_tail] =
        clip_hold(C.note_imgs.hold_mh, C.respack_info.holdAtlasMH);

    C.note_head_imgs = {
        [C.note.tap]: [C.note_imgs.click, C.note_imgs.click_mh],
        [C.note.drag]: [C.note_imgs.drag, C.note_imgs.drag_mh],
        [C.note.flick]: [C.note_imgs.flick, C.note_imgs.flick_mh],
        [C.note.hold]: [C.note_imgs.hold_head, C.note_imgs.hold_mh_head]
    };

    C.hold_body_imgs = [C.note_imgs.hold_body, C.note_imgs.hold_mh_body];
    C.hold_tail_imgs = [C.note_imgs.hold_tail, C.note_imgs.hold_mh_tail];

    C.hit_fx = await load_img("/res/hit_fx.png");

    for (let j = 0; j < C.respack_info.hitFx[1]; j++) {
        for (let i = 0; i < C.respack_info.hitFx[0]; i++) {
            C.hit_fx_imgs.push(
                cv_put_color(clip_block_img(
                    C.hit_fx,
                    (i / C.respack_info.hitFx[0]) * C.hit_fx.width,
                    (j / C.respack_info.hitFx[1]) * C.hit_fx.height,
                    ((i + 1) / C.respack_info.hitFx[0]) * C.hit_fx.width,
                    ((j + 1) / C.respack_info.hitFx[1]) * C.hit_fx.height
                ), C.pcolor)
            );
        }
    }

    // _DisplaceMap = BlockNoise1.png、_SparkMap = PointNoise.png，都只取 .r 通道
    C.block.imgs.displace = await load_img("/res/BlockNoise1.png");
    C.block.imgs.spark = await load_img("/res/PointNoise.png");

    // 着色器必须先就位：fx_init 在第一次 apply_postfx 时才惰性编译
    await load_shaders();

    const lib_manifest = await load_json_or_null("/res/library/index.json");
    if (lib_manifest && Array.isArray(lib_manifest.charts) && lib_manifest.charts.length > 0) {
        render_library(lib_manifest.charts);
        const s6 = lib_manifest.charts.find(e => 
            (e.slug && e.slug.toLowerCase() === "s6") || 
            (e.name && e.name.toLowerCase() === "s6")
        ) || lib_manifest.charts[0];
        open_library();
        await select_chart(s6);
    } else {
        await load_chart("/res/s6");
        ui.library_count.textContent = "未导入：py import_library.py";
        ui.start_overlay.classList.remove("hidden");
    }

    ui.start_overlay.onclick = () => {
        ui.start_overlay.classList.add("hidden");
        chart_started = true;
        play();
        if (!render_started) {
            render_started = true;
            render();
        }
    };

    ui.btn_play.onclick = toggle_play;

    ui.btn_library.onclick = open_library;
    ui.library_close.onclick = close_library;
    ui.library_overlay.onclick = e => {
        if (e.target === ui.library_overlay) close_library();
    };

    ui.progress_wrap.onclick = e => {
        const r = ui.progress_wrap.getBoundingClientRect();
        seek((e.clientX - r.left) / r.width * C.chart.duration);
    };

    window.onkeydown = e => {
        if (library_open()) {
            if (e.code === "Space" || e.code === "Escape") {
                e.preventDefault();
                close_library();
            }
            return;
        }
        if (lib_loading) return;
        if (e.code === "Space") {
            e.preventDefault();
            if (ui.start_overlay.classList.contains("hidden")) toggle_play();
            else ui.start_overlay.onclick();
        } else if (e.code === "ArrowLeft") {
            seek(get_time() - 2);
        } else if (e.code === "ArrowRight") {
            seek(get_time() + 2);
        } else if (e.code === "KeyL") {
            open_library();
        }
    };

    console.log(C);
};