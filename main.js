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
    // 自动演奏的分数/Combo 由谱面结算时间轴更新；combo >= 3 时显示数字和标签。
    game_hud: { score: 0, combo: 0, imgs: {} },
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
    bottom_bar: el("#bottom-bar"),
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
    loading_text: el("#loading-text"),

    /* 视频导出面板 */
    btn_export: el("#btn-export"),
    export_overlay: el("#export-overlay"),
    export_close: el("#export-close"),
    export_w: el("#exp-w"),
    export_h: el("#exp-h"),
    export_fps: el("#exp-fps"),
    export_bitrate: el("#exp-bitrate"),
    export_start: el("#exp-start"),
    export_end: el("#exp-end"),
    export_audio: el("#exp-audio"),
    export_est: el("#exp-est"),
    export_p720: el("#exp-p720"),
    export_p1080: el("#exp-p1080"),
    export_pwin: el("#exp-pwin"),
    export_whole: el("#exp-whole"),
    export_here: el("#exp-here"),
    export_go: el("#exp-go"),
    export_cancel: el("#exp-cancel"),
    export_progress_wrap: el("#export-progress-wrap"),
    export_progress_fill: el("#export-progress-fill"),
    export_status: el("#export-status")
};

// ---- 部署基址 --------------------------------------------------------------
// 本地 `py server.py` 时 BASE === "/"；部署到 GitHub Pages（子路径
// /PhigrosWebPlayer/）时 BASE === "/PhigrosWebPlayer/"。所有资源引用都过 R()，
// 同一份代码在根路径和子路径下都能跑，不用为部署维护第二份。
const BASE = new URL(".", document.baseURI).pathname;
// 把 "/xxx"（谱面库清单里的 path / asset / cover 就是这个形式）拼到基址后面
const R = p => BASE + String(p).replace(/^\/+/, "");

const load_audio = async (url, on_progress) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
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
        img.onerror = () => reject(new Error(`图片加载失败：${url}`));
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

/* ---------------- 首玩异象资源装载 ---------------- */

/* WireNoise：原版是 Texture2DArray（R8，1024x1024 共 11 层），
   导出时切成 wirenoise_00..10.png。WebGL2 下拼成真正的 2DArray 上传；
   WebGL1 没有 sampler2DArray，只绑第 0 层（噪声不演化，其余观感保留）。 */
const fx_load_wirenoise = async (F, layers) => {
    const gl = F.gl;
    const imgs = [];
    for (let i = 0; i < layers; i++)
        imgs.push(await load_img(R(`/res/effects/wirenoise_${String(i).padStart(2, "0")}.png`)));

    if (F.caps.has_texpack) {
        const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, F.wireNoise);
        // ★ R8 单通道的行对齐：宽度 1024 是 4 的倍数，UNPACK_ALIGNMENT=1 仍最稳
        //   （某些实现对 RED/UNSIGNED_BYTE 的组合要求显式指定，否则 texSubImage3D
        //    会报 INVALID_OPERATION=1282）。
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, w, h, layers.length, 0,
                      gl.RED, gl.UNSIGNED_BYTE, null);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        const r8 = new Uint8Array(w * h);
        for (let i = 0; i < layers.length; i++) {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(imgs[i], 0, 0);
            const px = ctx.getImageData(0, 0, w, h).data;
            // PNG 是 RGBA，噪声在哪个通道不确定；取三通道最大值最稳
            for (let k = 0, n = w * h; k < n; k++) {
                const o = k * 4;
                r8[k] = Math.max(px[o], px[o + 1], px[o + 2]);
            }
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1,
                             gl.RED, gl.UNSIGNED_BYTE, r8);
        }
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);   // 复原，别影响后面的 2D 上传
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        F.noise_texel = [1 / w, 1 / h];
    } else {
        gl.bindTexture(gl.TEXTURE_2D, F.wireNoise);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgs[0]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        F.noise_texel = [1 / imgs[0].naturalWidth, 1 / imgs[0].naturalHeight];
    }
};

/* 把 glitch 噪声图上传到 F.noise（Point+Repeat 由 mk_tex(true,true) 建纹理时设好，
   texImage2D 不会改采样参数）。带缓存守卫：按 img 对象身份比对，换图才重传。
   ★ audit F2（2026-10-06 修复）：原先唯一上传入口在 apply_postfx 的 if (!C.fx)
     首建分支里，两头都坏 —— ① fx_load_anomaly 先把 C.fx 建好 ⇒ 分支永不执行，
     而异象谱 postfx=null ⇒ C.glitch_img=null ⇒ F.noise 始终是无存储空纹理；
     ② 切谱（含 normal↔anomaly 互切）时 C.fx 已存在 ⇒ 换了 glitchTex 也不重传。 */
const fx_upload_noise = (F, img) => {
    if (!F || !img || F.noise_src === img) return;
    const gl = F.gl;
    gl.bindTexture(gl.TEXTURE_2D, F.noise);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    F.noise_src = img;
};

/* 方块噪声图的守卫式上传（BlockNoise1 = 位移图 / PointNoise = 火花图）。
   ★ 2026-10-17 修复：原先唯一上传入口在 apply_postfx 的 if (!C.fx) 首建分支里，
     与 glitch 噪声同款 bug（audit F2）——异象流程 fx_load_anomaly 会先把 C.fx 建好
     ⇒ 分支永不执行，u_disp/u_spark 永远是无存储空纹理：
       位移变「恒定偏移」（方块边缘纯直、整体错位），火花点全灭（红场变平色）。
     浏览器实测：手动重传后锯齿边 + 红色噪点场立现，与实机录像同族。 */
const fx_upload_block = (F) => {
    if (!F) return;
    const gl = F.gl;
    const dtex = C.block.imgs.displace, stex = C.block.imgs.spark;
    if (dtex && F.block_disp_src !== dtex) {
        gl.bindTexture(gl.TEXTURE_2D, F.displace);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dtex);
        F.block_disp_src = dtex;
    }
    if (stex && F.block_spark_src !== stex) {
        gl.bindTexture(gl.TEXTURE_2D, F.spark);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stex);
        F.block_spark_src = stex;
    }
};

/* 载入某个异象（res/effects/<name>.json）及其贴图，存到 C.fx_eff。
   ★ load_chart 跑的时候 C.fx 可能还没初始化（fx_init 是首次渲染时才懒初始化的），
     所以这里自己确保一次 —— 否则首屏选谱时异象会静默不生效。 */
const fx_load_anomaly = async (name) => {
    if (!C.fx) {
        try {
            C.fx = fx_init();
        } catch (e) {
            C.fx = null;
            C.fx_failed = true;
            console.error("异象载入时 WebGL 初始化失败：", e);
            return false;
        }
        // 不用在这里设尺寸：apply_postfx 每帧会按需重建 RT（见 C.fx.w !== w 分支）
    }
    const F = C.fx;
    if (!F) return false;
    const eff = await load_json_or_null(R(`/res/effects/${name}.json`));
    if (!eff) return false;

    const gl = F.gl;
    eff._frozen = false;

    /* F2（audit 2026-10-06 修复）：异象 glitch 噪声贴图。原版三首各引
       Glitch4in1_{2,0,1}.png（Hate/DS/Message prefab 的 glitchTex guid 实测），
       但三张 PNG 字节全同（md5 a75e842efeeb23644766b5b7fa468af6，512×512 RGB，
       .meta filterMode:0 / wrapU,V:2 = Point+Repeat）⇒ 只提取一份共用。
       ★ 必须在这里上传：apply_postfx 首建分支不会执行（本函数已先建 C.fx）。 */
    fx_upload_noise(F, await load_img(R("/res/effects/glitch4in1.png")));

    // GlitchDog 的两张图（三首共用）
    const gd = [await load_img(R("/res/effects/glitchdog_glitchmap.png")),
                await load_img(R("/res/effects/glitchdog_displace.png"))];
    gl.bindTexture(gl.TEXTURE_2D, F.glitchDogGlitchMap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gd[0]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, F.glitchDogDisplace);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gd[1]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // WireNoise 只 DS 用得到（11 层）。无 WebGL2 时 GlitchDog 根本不跑，
    // 也就没必要下载这 2.8MB。
    if (eff.settings.glitchDog && F.caps.has_texpack) {
        const frames = (eff.settings.glitchDog.static || {}).noiseFrameCount || 11;
        await fx_load_wirenoise(F, Math.round(frames));
    } else {
        /* 不用 wireNoise 的曲子（Message/ハテ）什么都不用做 ——
           GlitchDog 那条 pass 会整个跳过，shader 不会被编译进来采样这张纹理。
           ★ 别在这里 "占位分配" 一下：对一张已经用 texImage3D 初始化过的
             2DArray 纹理再调 texImage3D（哪怕同尺寸）会报 INVALID_OPERATION(1282)。
             只把 noise_texel 复位，让没有该字段的场合有合理默认值。 */
        F.noise_texel = [1, 1];
    }

    // kaleido 的两张图（只有 Message 有）
    if (eff.kaleido_static) {
        const kn = await load_img(R("/res/effects/kaleido_normal.png"));
        const kt = await load_img(R("/res/effects/kaleido_col.png"));
        gl.bindTexture(gl.TEXTURE_2D, F.kaleidoNormal);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, kn);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, F.kaleidoTrans);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, kt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    // DS 网格（Hidden/DsGrid 的 _MainTex = FrameBase_0，材质里平铺 10x10）
    if ((eff.imageTargets || []).some(x => x.target === "grid")) {
        const gt = await load_img(R("/res/effects/dsgrid_main.png"));
        gl.bindTexture(gl.TEXTURE_2D, F.gridTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    C.fx_eff = eff;
    return true;
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

/* ---------------- 首玩异象：AnimationDirector 求值器 ----------------
   逐条对应 AnimationDirector.Evaluate @0x1D2B680（见 _analysis\resolve_effect_params.py）：
     跨过 endTime 取末帧 -> 跨过首帧之前取首帧的 endValue -> 线性找区间 ->
     p = (t - cur.time) / span -> easeType 15 走 AnimationCurve(Hermite)，否则查 ease 表 ->
     ★ 结果 clamp 到 [0,1]（游戏侧 fminf + <0 归零）-> start + ep*(end - start)

   ★ 切线直接用序列化的 inSlope/outSlope，**不**按 weightedMode/weight 重算：
     全项目 161 对加权段穷举 9 种加权公式最高仅 3/161 匹配，且无权重信息的
     10009 对用序列化切线求值形态正常（详见 HANDOFF §12.2）。 */

const hermite_curve_eval = (curve, t) => {
    if (!curve || !curve.length) return 0;
    if (curve.length === 1) return curve[0][1];
    if (t <= curve[0][0]) return curve[0][1];
    if (t >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

    let i = 0;
    while (i + 1 < curve.length - 1 && curve[i + 1][0] < t) i++;
    const a = curve[i], b = curve[i + 1];
    const dt = b[0] - a[0];
    if (dt <= 0) return a[1];

    const s = (t - a[0]) / dt;
    const s2 = s * s, s3 = s2 * s;
    // a[2] = outSlope（出切线），b[3] = inSlope（入切线）
    return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * dt * a[2]
         + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * dt * b[3];
};

/* keys = res/effects/*.json 里压缩过的曲线：
   [time, startValue, endValue, easeType, curve|null] */
const director_eval = (keys, t) => {
    if (!keys || !keys.length) return 0;
    if (keys[0][0] > t) return keys[0][2];          // 首帧之前取首帧 endValue
    const n = keys.length;
    let i = 0;
    while (i < n - 1 && keys[i + 1][0] <= t) i++;
    const cur = keys[i];
    if (i === n - 1) return cur[2];                 // 末帧之后保持末值
    const span = keys[i + 1][0] - cur[0];
    if (span <= 0) return cur[2];
    const p = (t - cur[0]) / span;

    const et = cur[3];
    let ep = (et === 15) ? hermite_curve_eval(cur[4], p) : ease(p, et);
    ep = ep < 0 ? 0 : (ep > 1 ? 1 : ep);             // ★ 游戏侧 clamp
    return cur[1] + ep * (keys[i + 1][2] - cur[1]);
};

/* 一个已载入的异象定义（C.fx.eff）：曲线 + 静态默认值 + 时间闸。 */
const eff_ev = (eff, name, t) => director_eval(eff.curves[name], t);

/* 取某 settings 对象在 t 时刻的完整字段值：静态打底，被驱动的用曲线覆盖。 */
const eff_settings = (eff, obj, t) => {
    const d = eff.settings[obj];
    if (!d) return null;
    const st = Object.assign({}, d.static);
    for (const f in d.driven) st[f] = eff_ev(eff, d.driven[f], t);
    return st;
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
     vignette.frag     ≈ PostEffects_VignettePlus（应用趟）
     vignette_noise.frag ≈ PostEffects_VignettePlus（噪声生成趟，半分辨率 RT）
     esc.frag          ≈ PostEffects_ESCContol
     copy.frag         直通拷贝
     block_disp.glsl   位移场（被下面几个 include）
     block_cov.frag    ≈ Unlit/BlockCompose
     block_layers.frag ≈ Unlit/DisabledBlock（加法层，烘进场景）
     block_ring.frag   ≈ Unlit/EdgeMask + Unlit/GlowMask
     block_apply.frag  ≈ Unlit/ActiveBlock / ReadyBlock（disabled 由 block_layers 接管）

     首玩异象四件套（Chapter9 baseline 的 LevelEffects，原版 HLSLCC 产物见
     _analysis\shader_blob_c9_clean\）：
     glitchdog.frag        ≈ PostEffects/GlitchDog（DS 核心 pass，26 uniform）
     dimensionslash.frag   ≈ PostEffects/DimensionSlash（DS 的 5 条切口）
     lightband.frag        ≈ PostEffects/LightBand（Message 横向光带）
     kaleidoblackmask.frag ≈ Hidden/KaleidoBlackMask（Message 万花筒材质）
     blendmask.frag        ≈ blackMask UI Image（黑幕，bgAlpha 驱动）
     dsgrid.frag           ≈ Hidden/DsGrid（DS 背景网格，加法；真身见 shader_blob_c9）
     composeover.frag      note 层 alpha-over 合回背景层（分层渲染专用） */
const SHADER_FILES = {
    fx_vs:       "fx.vert",
    // ES 3.00 版（GlitchDog 要 sampler2DArray，只能在 WebGL2 上跑，
    // 且 ES 1.00/3.00 的 shader 不能混用，所以 vertex 也要配一份）
    fx30_vs:     "fx30.vert",
    glitch:      "glitch.frag",
    rgbShift:    "rgbshift.frag",
    vignette:    "vignette.frag",
    vignetteNoise: "vignette_noise.frag",
    esc:         "esc.frag",
    copy:        "copy.frag",
    // 首玩异象
    glitchDog:   "glitchdog.frag",
    dimSlash:    "dimensionslash.frag",
    lightBand:   "lightband.frag",
    kaleido:     "kaleidoblackmask.frag",
    blendMask:   "blendmask.frag",
    dsGrid:      "dsgrid.frag",
    overCompose: "composeover.frag",
    bloom:       "bloom.frag",
    lensDist:    "lensdistortion.frag",
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
    const texts = await Promise.all(keys.map(k => load_text(R(`/shader/${SHADER_FILES[k]}`))));
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

/* defines = 注入 fragment shader 顶部的宏（如 FX_HAS_DERIV）。
   vs_key = 换 vertex shader（ES 3.00 的 shader 必须配 ES 3.00 的 vertex）。

   ★ ES 3.00 的 shader 首行必须是 `#version 300 es`，任何东西都不能加在它前面
     （包括 #define），所以有 defines 时只允许用于 ES 1.00 的 shader。 */
const fx_program = (gl, fs_src, defines, vs_key) => {
    if (defines && defines.length) {
        if (/^\s*#version/.test(fs_src))
            throw new Error("ES 3.00 shader 不能注入 #define（#version 必须在首行）");
        fs_src = defines.map(d => `#define ${d}\n`).join("") + fs_src;
    }
    const p = gl.createProgram();
    gl.attachShader(p, fx_compile(gl, gl.VERTEX_SHADER, SH[vs_key || "fx_vs"]));
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
    const gl2 = canvas.getContext("webgl2", opts);
    const gl = gl2 || canvas.getContext("webgl", opts);
    if (!gl) return null;

    /* 异象 shader 的可选能力探测：
       has_texpack —— GlitchDog 的 _WireNoiseArray 是 sampler2DArray，
                      ES 3.00（WebGL2）才有；ES 1.00 里没这个类型，
                      所以拿不到 WebGL2 就整个 GlitchDog program 都不编译。
       has_deriv   —— DimensionSlash 需要屏幕空间导数。
                      ★ ES 3.00 里 dFdx/dFdy 是**内建**的（不需要扩展，
                        在 ES 3.00 上下文里 getExtension 反而返回 false）；
                      ES 1.00 才需要 OES_standard_derivatives。 */
    const has_texpack = !!gl2;
    const has_deriv = has_texpack || !!gl.getExtension("OES_standard_derivatives");
    const glsl_defs = has_deriv ? ["FX_HAS_DERIV"] : [];

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
        /* 首玩异象的贴图。默认 1x1 白/黑占位，载入真实资源后覆盖。
           ★ wireNoise 必须用 gl.createTexture() 单独建 —— 它要绑到
             TEXTURE_2D_ARRAY 目标上传 2DArray，不能复用 mk_tex() 建的
             TEXTURE_2D 纹理（拿 2D 纹理绑 ARRAY 目标会 INVALID_OPERATION=1282）。 */
        glitchDogGlitchMap: mk_tex(false, false),
        glitchDogDisplace: mk_tex(false, false),
        wireNoise: (() => { const t = gl.createTexture(); return t; })(),
        kaleidoNormal: mk_tex(false, false),
        kaleidoTrans: mk_tex(false, false),
        /* VignettePlus 噪声 RT（原版 Renderer 每次 GetTemporary 的那张）：
           尺寸 = 画面 × noiseSampleRate（hate/Message 0.5 = 半分辨率），LINEAR+CLAMP
           （Unity 临时 RT 默认 Bilinear/Clamp）。懒分配：尺寸由 vignette 那趟按当前
           曲线的 noiseSampleRate 算（见 fx_render_anomaly），窗口变了自动重开。
           noise_w/h = 当前已分配尺寸（0 = 还没建过）。 */
        noiseRT: mk_tex(false, false),
        noise_w: 0, noise_h: 0,
        /* 分层渲染（异象）：fg = note 层画布上传的目标（背景层在 tex[0/1] 里 ping-pong，
           合成一趟 base+over 需要第三张纹理）；gridTex = DS 网格的 _MainTex(FrameBase_0)。
           ★ gridTex 必须 REPEAT（mk_tex(true,..)）：dsgrid.frag 按 _MainTex_ST=(10,10)
             平铺采样 uv∈[0,10]，且原版 FrameBase_0.png.meta 的 wrapU/wrapV=0（Repeat）。
             用 CLAMP 会把超出 [0,1] 的 ~90% 屏面钳采到贴图白色边框线 ⇒ 10×10 格子阵列
             变成整屏白灰雾（2026-10-05 同帧 A/B 实测，见 _analysis\anomaly_audit_20261005.md 补录）。 */
        fg: mk_tex(false, false),
        gridTex: mk_tex(true, false),
        fbo: gl.createFramebuffer(),
        w: 0, h: 0,
        caps: { has_texpack, has_deriv, is_gl2: !!gl2 },
        prog: {
            glitch: fx_program(gl, SH.glitch),
            rgbShift: fx_program(gl, SH.rgbShift),
            vignette: fx_program(gl, SH.vignette),
            vignetteNoise: fx_program(gl, SH.vignetteNoise),
            esc: fx_program(gl, SH.esc),
            copy: fx_program(gl, SH.copy),
            bLayers: fx_program(gl, SH.block_layers),
            bCov: fx_program(gl, SH.block_cov),
            bRing: fx_program(gl, SH.block_ring),
            bApply: fx_program(gl, SH.block_apply),
            // 异象四个。glitchDog / dimSlash 是 ES 3.00（前者要 sampler2DArray，
            // 后者用内建 dFdx/bias），只在 WebGL2 上编译，配套 fx30_vs。
            // 没有 WebGL2 时它们是 null，fx_render_anomaly 会跳过该 pass。
            glitchDog: has_texpack ? fx_program(gl, SH.glitchDog, null, "fx30_vs") : null,
            dimSlash: has_texpack ? fx_program(gl, SH.dimSlash, null, "fx30_vs") : null,
            lightBand: fx_program(gl, SH.lightBand),
            kaleido: fx_program(gl, SH.kaleido),
            blendMask: fx_program(gl, SH.blendMask),
            dsGrid: fx_program(gl, SH.dsGrid),
            over: fx_program(gl, SH.overCompose),
            bloom: fx_program(gl, SH.bloom),
            lensDist: fx_program(gl, SH.lensDist)
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

/* 绑 sampler2DArray（GlitchDog 的 _WireNoiseArray）。
   ★ 不能用 fx_bind：它硬编码 bindTexture(TEXTURE_2D)，而 array 纹理必须绑到
     TEXTURE_2D_ARRAY 目标，否则采样时 INVALID_OPERATION(1282)。 */
const fx_bind_array = (gl, unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
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

/* ---------------- 首玩异象渲染 ----------------
   pass 顺序 = 运行时 postEffects 列表序 = *LevelEffects.Start() 里 AddEffect
   的调用序（2026-10-18 反编译核实：PostProcessingManager.AddEffects @0x1DAD898
   把效果追加到列表尾，OnRenderImage @0x1DBD01C 按列表序依次执行）。
   ★ 别再拿 prefab 的字段声明序当真（_analysis\postfx_pass_order.txt 记的是
     YAML 里的引用序，和 Start() 的调用序不同，此前端口就是按它排错的）：
     Hate    : Glitch -> RGBShift -> VignettePlus -> LensDistortion -> ColorBalance
     DS      : RGBShift -> Glitch -> GlitchDog -> LensDistortion -> Bloom -> DimensionSlash -> VignettePlus
     Message : Glitch -> ColorBalance -> LightBand -> Bloom -> VignettePlus -> LensDistortion
   其中 Hate 的 ColorBalance（ESC）排在 VignettePlus 之后是关键：contrast
   121.63 起 1.3、159.72 起 1.8 ⇒ 把 VP 抬起来的噪声暗部（max(col, noise*0.4)）
   又压回黑（(x-0.5)*1.8+0.5，x<0.222 直接归零），late 段屏幕上只剩稀疏细雪；
   端口此前把 colorBalance 排在 VP 前面，噪声没被压 —— 就是一整片亮雪花。
   各曲线的求值统一走上面的 director_eval（ease 表 / Hermite / clamp）。 */

/* GlitchDog：DS 的核心 pass。需要 displaceMap / glitchMap / wireNoise 三张图。 */
const fx_pass_glitchdog = (F, cur, eff, t, st) => {
    const g = F.gl;
    /* settings 里的向量是 Unity YAML 的字典：scale 系列 {x,y}、颜色 {r,g,b,a}。
       这里曾按数组 [0] 取 —— undefined 传进 uniform 就是 NaN，shader 里
       tint/uv 全变 NaN ⇒ fragColor 全黑 ⇒ DS 整屏黑。现在按字典取，
       同时兼容数组（万一以后手写 JSON 用数组）。 */
    const xy = (v, d) => (v && v.x !== undefined) ? [v.x, v.y] : (Array.isArray(v) ? v : d);
    const rgb = (v, d) => (v && v.r !== undefined) ? [v.r, v.g, v.b] : (Array.isArray(v) ? v : d);
    const cm = xy(st.glitchMapScale, [1, 1]);
    const ds = xy(st.displaceMapScale, [1, 1]);
    const ns = xy(st.noiseScale, [1, 1]);
    const no = xy(st.noiseOffset, [0, 0]);
    const dof = xy(st.displaceMapOffset, [0, 0]);
    const gmo = xy(st.glitchMapOffset, [0, 0]);
    const cc = rgb(st.centerColor, [0, 0, 0]);
    const ec = rgb(st.edgeColor, [0, 0, 0]);
    fx_pass(F.prog.glitchDog, F.tex[1 - cur], (p, gl) => {
        fx_bind(gl, 0, F.tex[cur], p.loc.u_src);
        fx_bind(gl, 1, F.glitchDogDisplace, p.loc.u_displaceMap);
        fx_bind(gl, 2, F.glitchDogGlitchMap, p.loc.u_glitchMap);
        if (F.caps.has_texpack) fx_bind_array(gl, 3, F.wireNoise, p.loc.u_wireNoise);
        gl.uniform4f(p.loc.u_time, t, t, 0, 0);
        gl.uniform2f(p.loc.u_noiseTexelSize,
                     F.noise_texel ? F.noise_texel[0] : 1, F.noise_texel ? F.noise_texel[1] : 1);
        gl.uniform1f(p.loc.u_noiseFrameCount, st.noiseFrameCount ?? 11);
        gl.uniform1f(p.loc.u_noiseMoveSpeed, st.noiseMoveSpeed ?? 0);
        gl.uniform1f(p.loc.u_noiseEvolveSpeed, st.noiseEvolveSpeed ?? 0);
        gl.uniform2f(p.loc.u_noiseScale, ns[0], ns[1]);
        gl.uniform2f(p.loc.u_noiseOffset, no[0], no[1]);
        gl.uniform1f(p.loc.u_seamBlend, st.seamBlend ?? 0.02);
        gl.uniform1f(p.loc.u_centerMaskRadius, st.centerMaskRadius ?? 0.094);
        gl.uniform1f(p.loc.u_centerMaskSmooth, st.centerMaskSmoothness ?? 0.07);
        gl.uniform1f(p.loc.u_edgeMaskRadius, st.edgeMaskRadius ?? 0.12);
        gl.uniform1f(p.loc.u_edgeMaskSmooth, st.edgeMaskSmoothness ?? 0.41);
        gl.uniform1f(p.loc.u_displaceStrength, st.displaceStrength ?? 0.2);
        gl.uniform2f(p.loc.u_displaceMapOffset, dof[0], dof[1]);
        gl.uniform2f(p.loc.u_displaceMapScale, ds[0], ds[1]);
        gl.uniform1f(p.loc.u_displaceSpeed, st.displaceSpeed ?? 1);
        gl.uniform1f(p.loc.u_glitchMapBright, st.glitchMapBrightness ?? 0);
        gl.uniform1f(p.loc.u_glitchMapContrast, st.glitchMapContrast ?? 3.5);
        gl.uniform2f(p.loc.u_glitchMapOffset, gmo[0], gmo[1]);
        gl.uniform2f(p.loc.u_glitchMapScale, cm[0], cm[1]);
        gl.uniform3f(p.loc.u_centerColor, cc[0], cc[1], cc[2]);
        gl.uniform3f(p.loc.u_edgeColor, ec[0], ec[1], ec[2]);
        gl.uniform1f(p.loc.u_colorBlend, st.colorBlend ?? 0.776);
    });
    return 1 - cur;
};

/* DimensionSlash：5 条切口。几何来自 slashes（取 time<=t 的最后一条）。 */
const fx_pass_dimslash = (F, cur, eff, t) => {
    const pos = new Float32Array(10), nrm = new Float32Array(10),
          off = new Float32Array(10), str = new Float32Array(5);
    let count = 0;
    const sl = eff.slashes || {};
    const order = Object.keys(sl).sort();
    for (const name of order) {
        const infos = sl[name] || [];
        let geo = null;
        for (const inf of infos) if (inf.time <= t) geo = inf; else break;
        const strength = eff_ev(eff, name + "Strength", t);
        if (!geo || strength <= 0) continue;
        // pos = (x, y, 0, 0)；normal = 由 lineDir 转的单位向量；offset = 由 slashDir
        pos[count * 2] = geo.pos ? geo.pos.x : 0;
        pos[count * 2 + 1] = geo.pos ? geo.pos.y : 0;
        nrm[count * 2] = Math.cos(geo.lineDir || 0);
        nrm[count * 2 + 1] = Math.sin(geo.lineDir || 0);
        off[count * 2] = Math.cos(geo.slashDir || 0);
        off[count * 2 + 1] = Math.sin(geo.slashDir || 0);
        str[count] = strength;
        count++;
        if (count >= 5) break;
    }
    const st = eff_settings(eff, "dimensionSlash", t) || {};
    const lc = st.slashLightColor || [1, 1, 1];
    fx_pass(F.prog.dimSlash, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform2fv(p.loc.u_slashPos, pos);
        g.uniform2fv(p.loc.u_slashNormal, nrm);
        g.uniform2fv(p.loc.u_slashOffset, off);
        g.uniform1fv(p.loc.u_slashStrength, str);
        g.uniform1i(p.loc.u_slashCount, count);
        g.uniform1f(p.loc.u_lightStrength, st.slashLightStrength ?? 1);
        g.uniform1f(p.loc.u_lightFalloff, st.slashLightFalloff ?? 10);
        g.uniform3f(p.loc.u_lightColor, lc[0], lc[1], lc[2]);
    });
    return 1 - cur;
};

/* LightBand：Message 的反色光带（带内 ≈ 负片，bandWidth 0→1 = 反色区展开到全屏）。
   ★ bandNormal 不在 settings 里（LightBandSettings 只有 bandPos/bandDir/bandWidth/
     bandSmoothness/bandBrightness，见 dump.cs TypeDefIndex 4101），它是 SetMaterialData
     每帧写进材质的。原版实测（idalib 反编译，2026-10-06）：
       重载 SetMaterialData(mat) @0x1DBC658：aspect = width / height；
       私有 SetMaterialData(mat, aspect) @0x1DBC510：
         sincosf(angle = bandDir × 0.017453)   // ★ bandDir 是【度】不是弧度
                                                //   glibc/bionic: sincosf(x, sinp, cosp)
                                                //   sin → &a15+4，cos → &a15
         _BandPos    = (bandPos.x, bandPos.y)  // 不乘 aspect
         _BandNormal = (-sin(bandDir°) × aspect,  cos(bandDir°))   // dir 的【垂线】
     bandDir = 0° ⇒ 法线 = (0,1) ⇒ 光带是**横向**的，从中线向上/下展开。
     ⚠ 曾错写成 (cos,sin)（把带方向当成了法线 = 转 90°：竖带左右展开），
       且注释错标「弧度」、缺 aspect —— 2026-10-06 用户报「展开方向错了」后按反编译改正。 */
const fx_pass_lightband = (F, cur, eff, t) => {
    const st = eff_settings(eff, "lightBand", t) || {};
    const bp = st.bandPos || { x: 0.5, y: 0.5 };
    const rad = (st.bandDir ?? 0) * Math.PI / 180;   // 原版 bandDir 以度为单位
    const aspect = (F.w && F.h) ? F.w / F.h : 1;     // 原版 SetMaterialData(mat, w/h)
    fx_pass(F.prog.lightBand, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform2f(p.loc.u_bandPos, bp.x, bp.y);
        g.uniform2f(p.loc.u_bandNormal, -Math.sin(rad) * aspect, Math.cos(rad));
        g.uniform1f(p.loc.u_bandWidth, st.bandWidth ?? 0);
        g.uniform1f(p.loc.u_bandSmooth, st.bandSmoothness ?? 0);
        g.uniform1f(p.loc.u_bandBright, st.bandBrightness ?? 1);
    });
    return 1 - cur;
};

/* KaleidoBlackMask：Message 的万花筒材质。mixStrength 由 kaleidoMix 曲线驱动。 */
const fx_pass_kaleido = (F, cur, eff, t) => {
    const mix = eff_ev(eff, "kaleidoMix", t);
    const st = eff.kaleido_static || {};
    const nst = st.normalST || [1, 1, 0, 0];
    const tst = st.transST || [1, 1, 0, 0];
    fx_pass(F.prog.kaleido, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.kaleidoNormal, p.loc.u_normal);
        fx_bind(g, 2, F.kaleidoTrans, p.loc.u_transMap);
        g.uniform4f(p.loc.u_time, t, t, 0, 0);
        g.uniform2f(p.loc.u_normalST, nst[0], nst[1]);
        g.uniform2f(p.loc.u_normalSTOff, nst[2] || 0, nst[3] || 0);
        g.uniform2f(p.loc.u_transST, tst[0], tst[1]);
        g.uniform2f(p.loc.u_transSTOff, tst[2] || 0, tst[3] || 0);
        g.uniform1f(p.loc.u_normalStrength, st.normalStrength ?? 1);
        g.uniform2f(p.loc.u_normalMoveDir,
                    (st.normalMoveDir || [1, 0])[0], (st.normalMoveDir || [1, 0])[1]);
        g.uniform1f(p.loc.u_normalMoveSpeed, st.normalMoveSpeed ?? 0);
        g.uniform2f(p.loc.u_transMoveDir,
                    (st.transMoveDir || [1, 0])[0], (st.transMoveDir || [1, 0])[1]);
        g.uniform1f(p.loc.u_transMoveSpeed, st.transMoveSpeed ?? 0);
        g.uniform1f(p.loc.u_colorHueShift, st.colorHueShift ?? 0);
        g.uniform1f(p.loc.u_colorContrast, st.colorContrast ?? 1);
        g.uniform1f(p.loc.u_colorSaturation, st.colorSaturation ?? 1);
        g.uniform1f(p.loc.u_colorMixStrength, mix);
        g.uniform1f(p.loc.u_centerMaskRadius, st.centerMaskRadius ?? 0.5);
        g.uniform1f(p.loc.u_centerMaskSmooth, st.centerMaskSmoothness ?? 0.5);
    });
    return 1 - cur;
};

/* 统一约定：所有 fx_pass_* 助手返回「下一个可写的槽」。
   cur 是**当前画面所在的槽**，输出写到 F.tex[1-cur]，所以跑完一个 pass 后
   下一个可写槽就是 1-cur。被跳过的 pass（continue）不改变 cur。 */
const fx_pass_blackmask = (F, cur, eff, t) => {
    const it = (eff.imageTargets || []).find(x => x.target === "blackMask");
    if (!it) return cur;
    const a = eff_ev(eff, it.a_from, t);
    if (a <= 0) return cur;
    fx_pass(F.prog.blendMask, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform4f(p.loc.u_rgba, it.rgb[0], it.rgb[1], it.rgb[2], a);
    });
    return 1 - cur;
};

/* Hidden/DsGrid：DS 背景网格，加法合成（Blend SrcAlpha/One，见 dsgrid.frag 头注释）。
   常数取自 DesultorySignals_Grid.mat；gridOpacity 曲线在 res/effects/desultorysignals.json。
   freeze：原版在 nowTime>=freezeTime 时一次性 SetFloat(_GridScaleSpeed,0) 把脉冲定格；
   这里按状态谓词喂 0（与 glitchDog 的 freeze 谓词一致，往回 seek 自动还原）。 */
const fx_pass_grid = (F, cur, eff, t) => {
    const a = eff_ev(eff, "gridOpacity", t);
    if (a <= 0) return cur;
    const ft = eff.scalars ? eff.scalars.freezeTime : null;
    const frozen = ft !== null && ft !== undefined && t >= ft;
    fx_pass(F.prog.dsGrid, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.gridTex, p.loc.u_mainTex);
        g.uniform2f(p.loc.u_mainTexST, 10, 10);
        g.uniform3f(p.loc.u_gridColor, 0.8066038, 0.990657, 1);
        g.uniform3f(p.loc.u_bloomColor, 0.514151, 0.5749958, 1);
        g.uniform1f(p.loc.u_gridBright, 0.57);
        g.uniform1f(p.loc.u_bloomBright, 0.59);
        g.uniform1f(p.loc.u_scaleSpeed, frozen ? 0 : 1);
        g.uniform1f(p.loc.u_time, t);
        g.uniform1f(p.loc.u_opacity, a);
    });
    return 1 - cur;
};

/* 背景层效果：黑幕 → kaleido → 网格。
   ★ 原版这三样全挂在 effect Canvas（SortingLayer=Background、ScreenSpaceCamera）
     的 Image 上，画在判定线/note **之下**（层级见 _analysis\_hier_dump.txt：
     Message/Hate 只有 BlackMask 一个孩子、DS 只有 Grid）——
     所以它们必须作用在「只有曲绘的背景画布」上，再把 note 层盖回来，
     而不是糊在整个已合成的帧上（否则 Message bgAlpha≡1 会把 note 一起染黑）。
   Message 的 BlackMask Image 挂着 kaleidoMat（kaleido 就是黑幕那一笔），
   bgAlpha≡1 时黑幕先铺黑、kaleido 再整幅替换成 outc*mask，合成结果与原版一致。 */
const fx_layer_bg = (F, cur, eff, t) => {
    cur = fx_pass_blackmask(F, cur, eff, t);
    if (eff.kaleido_static) cur = fx_pass_kaleido(F, cur, eff, t);
    if ((eff.imageTargets || []).some(x => x.target === "grid")) cur = fx_pass_grid(F, cur, eff, t);
    return cur;
};

/* 主调度：按 eff.order（= 运行时 postEffects 列表序，见文件头注释）依次跑。
   常规效果（glitch / rgbShift / vignette / esc）复用已有 shader，
   异象专有的四个走各自的移植版。
   ★ 黑幕/kaleido/网格不在这里跑 —— 它们属于背景层，在 fx_layer_bg 里
     （note 层合成之前）执行；它们本来也不在 postEffects 列表里，
     order 数组只有运行时效果链（message 里旧的 "kaleido" 条目已清掉）。 */
const fx_render_anomaly = (F, cur, eff, t) => {
    const gl = F.gl;
    const S = eff.settings;

    // 黑幕以前在这里整帧糊一刀（bgAlpha≡1 的 Message 会把 note 一起染黑）；
    // 现在挪进 fx_layer_bg，在 note 层合成之前作用于背景画布。

    // 每首的顺序来自 *_LevelEffects.prefab 的字段声明序（见文件头注释）
    const order = eff.order;
    for (const obj of order) {
        /* glitchDog / dimSlash 是 ES 3.00 shader，无 WebGL2 时没编译出来
           （program 为 null），整条 pass 跳过，其余照常跑。 */
        const pj = F.prog[{ glitchDog: "glitchDog", dimSlash: "dimSlash" }[obj]];
        if ((obj === "glitchDog" || obj === "dimensionSlash") && !pj) continue;
        switch (obj) {
            case "glitch": {
                const st = eff_settings(eff, "glitch", t) || {};
                const range = st.glitchRange ?? 0;
                if (range <= 0) continue;
                const gd = glitch_dirs(t);
                fx_pass(F.prog.glitch, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    fx_bind(g, 1, F.noise, p.loc.u_noise);
                    g.uniform1f(p.loc.u_range, range);
                    g.uniform3f(p.loc.u_dirA, gd.A[0], gd.A[1], gd.A[2]);
                    g.uniform3f(p.loc.u_dirB, gd.B[0], gd.B[1], gd.B[2]);
                    g.uniform3f(p.loc.u_dirC, gd.C[0], gd.C[1], gd.C[2]);
                });
                cur = 1 - cur;
                break;
            }
            case "rgbShift": {
                const st = eff_settings(eff, "rgbShift", t) || {};
                const c = st.center || { x: 0.5, y: 0.5 };   // Unity YAML 是 {x:,y:}
                fx_pass(F.prog.rgbShift, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    g.uniform1f(p.loc.u_radius, st.radius ?? 0);
                    g.uniform1f(p.loc.u_deform, st.screenDeform ?? 0.45);
                    g.uniform2f(p.loc.u_center, c.x, c.y);
                });
                cur = 1 - cur;
                break;
            }
            case "vignettePlus": {
                const st = eff_settings(eff, "vignettePlus", t) || {};
                const c = st.center || { x: 0.5, y: 0.5 };
                /* 噪声先烘：原版 Renderer 在 noiseBrightness>0 时每次
                   GetTemporary((int)(w*rate), (int)(h*rate)) → blit 生成趟 → blit 应用趟。
                   幅度（×_NoiseBrightness/_NoiseSaturation）烘在 RT 里，应用趟只当它开关。 */
                const nb = st.noiseBrightness ?? 0;
                if (nb > 0) {
                    const rate = st.noiseSampleRate ?? 0.5;
                    const nw = Math.max(1, Math.floor(F.w * rate));
                    const nh = Math.max(1, Math.floor(F.h * rate));
                    if (F.noise_w !== nw || F.noise_h !== nh) {
                        gl.bindTexture(gl.TEXTURE_2D, F.noiseRT);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nw, nh, 0,
                                      gl.RGBA, gl.UNSIGNED_BYTE, null);
                        F.noise_w = nw; F.noise_h = nh;
                    }
                    fx_pass(F.prog.vignetteNoise, F.noiseRT, (p, g) => {
                        g.uniform1f(p.loc.u_time, t);
                        g.uniform1f(p.loc.u_noiseBright, nb);
                        g.uniform1f(p.loc.u_noiseSat, st.noiseSaturation ?? 1);
                    }, [nw, nh]);
                }
                /* 应用趟：噪声+扫描线（曲线驱动 noiseBrightness/lineOpacity，
                   hate 全程 0.36→0.8→1.5 / 0.02→0.1）。
                   late 段链尾还有 ESC（contrast 1.3→1.8）会把这层噪声压回黑，
                   hate 的 order 里 colorBalance 排在 vignettePlus 之后，别调换。 */
                fx_pass(F.prog.vignette, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    fx_bind(g, 1, F.noiseRT, p.loc.u_noiseTex);
                    g.uniform1f(p.loc.u_radius, st.radius ?? 1);
                    g.uniform1f(p.loc.u_smooth, st.smoothness ?? 1);
                    g.uniform1f(p.loc.u_darkness, st.darkness ?? 1);
                    g.uniform2f(p.loc.u_center, c.x, c.y);
                    g.uniform1f(p.loc.u_noiseBright, nb);
                    g.uniform1f(p.loc.u_lineOpacity, st.lineOpacity ?? 0);
                });
                cur = 1 - cur;
                break;
            }
            case "colorBalance": {
                const st = eff_settings(eff, "colorBalance", t) || {};
                /* ESC（Exposure_Saturate_ContrastSettings）三条：
                   rgb = avg + contrast * (satMix - avg)，再乘 brightness。
                   avg 是 settings.averageColor（prefab 静值 0.5,0.5,0.5）——
                   以前端口硬传 (0,0,0)，contrast>1 时支点错到 0 ⇒ 暗场整体提亮、
                   高光更容易削顶（hate 165.5 的中央光柱被推成纯白即此因）。 */
                const av = st.averageColor || { r: 0.5, g: 0.5, b: 0.5 };
                fx_pass(F.prog.esc, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    g.uniform1f(p.loc.u_brightness, st.brightness ?? 1);
                    g.uniform1f(p.loc.u_saturation, st.saturation ?? 1);
                    g.uniform1f(p.loc.u_contrast, st.contrast ?? 1);
                    g.uniform3f(p.loc.u_average, av.r, av.g, av.b);
                });
                cur = 1 - cur;
                break;
            }
            case "lensDistortion": {
                const st = eff_settings(eff, "lensDistortion", t) || {};
                const c = st.center || { x: 0.5, y: 0.5 };
                const conv = st.convergence ?? 0;
                if (conv === 0) continue;          // 无畸变就别占一趟
                /* ★ 2026-10-18：C# 绑定侧对 _Size/_Convergence 各乘 0.01
                   （LensDistortionSettings.SetMaterialData(mat, aspect) @0x1DBBE94：
                     LDR S9,[0xC3477C]（= 0x3C23D70A = 0.01f）→ FMUL size×S9 → SetFloat(_Size)；
                     同常量再 FMUL convergence —— edgeSmoothness/aspect 直传）。
                   之前拿资产原值 80/−8 直接绑：r = dist/(60)·… 畸变项 8r² ~ 1e-3，
                   整趟退化成「贴边 2.5% 淡出」，视频里那条又宽又硬的鱼眼黑框根本出不来。
                   缩放后 _Size=0.8、_Conv=−0.08 ⇒ 采样坐标外移 k=1+0.08r²，可见画面收进
                   中央 ~91%，四边出现 ~4.5%（L/R）/ ~3%（T/B）黑框 + 外圈可见压缩畸变，
                   与视频 v198 实测（L 0.0451 / T 0.0315）逐点吻合。 */
                const aspect = st.useScreenAspect
                    ? (F.w / Math.max(1, F.h))
                    : (st.manualAspect ?? 1);
                fx_pass(F.prog.lensDist, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    g.uniform2f(p.loc.u_center, c.x, c.y);
                    g.uniform1f(p.loc.u_size, (st.size ?? 100) * 0.01);
                    g.uniform1f(p.loc.u_convergence, conv * 0.01);
                    g.uniform1f(p.loc.u_aspect, aspect);
                    g.uniform1f(p.loc.u_edgeSmooth, st.edgeSmoothness ?? 0.025);
                });
                cur = 1 - cur;
                break;
            }
            case "bloom": {
                const st = eff_settings(eff, "bloom", t) || {};
                const bc = st.bloomColor || { r: 1, g: 1, b: 1 };
                // ★ 被 bloomBrightness 曲线驱动的是 brightness，不是 intensity。
                //   intensity 是静态的全局系数（DS 1.85 / Message 1.61）。
                const bright = st.brightness ?? 1;
                const inten = (st.intensity ?? 1) * bright;
                if (inten <= 0) continue;
                fx_pass(F.prog.bloom, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    // u_blurred 复用 u_src（bloom.frag 内部自己做阈值+模糊）
                    fx_bind(g, 1, F.tex[cur], p.loc.u_blurred);
                    g.uniform1f(p.loc.u_intensity, inten);
                    g.uniform3f(p.loc.u_bloomColor, bc.r, bc.g, bc.b);
                    g.uniform2f(p.loc.u_texel, 1 / Math.max(1, F.w), 1 / Math.max(1, F.h));
                    g.uniform1f(p.loc.u_threshold, st.threshold ?? 0.3);
                });
                cur = 1 - cur;
                break;
            }
            case "glitchDog": {
                const st = eff_settings(eff, "glitchDog", t) || {};
                /* DS 的 freeze（2026-10-17 字节级复核后重写，见 _analysis\anomaly_audit_20261017.md）：
                   原版在 nowTime >= freezeTime 时跑一次冻结块（freezed 闩锁 @+0x17C，位于所有
                   director 求值之后），写五个字段 ——
                     · noiseMoveSpeed=0 / noiseEvolveSpeed=0 / displaceSpeed=0.0：这三个没有曲线
                       驱动，写一次后原版永久生效 ⇒ 端口用状态谓词每帧覆写来等效（往回拖可还原）；
                     · glitchMapBrightness=1.6（0x3FCCCCCD）/ glitchMapContrast=3.5（0x40600000）：
                       下一帧就被 AnimationDirector 曲线覆回（brightness 1.5 → 147.98 起 1.6/0
                       闪烁、contrast 0.5 → 146.99 起 3.5）⇒ 只在冻帧当帧 snap，不持续覆写。
                   旧注释引用的 _sample_focus.txt「0.4/0/4」是 resolve_effect_params.py 的硬编码
                   误读（真值 0.0/1.6/3.5），源头（报告 §3.2 / resolve / main.js）已一并修正。 */
                const ft = eff.scalars ? eff.scalars.freezeTime : null;
                const active = ft !== null && ft !== undefined && t >= ft;
                if (active) {
                    st.noiseMoveSpeed = 0;
                    st.noiseEvolveSpeed = 0;
                    st.displaceSpeed = 0;
                    if (!eff._frozen) {          // 冻帧当帧：复刻原版那一帧的 1.6 / 3.5
                        st.glitchMapBrightness = 1.6;
                        st.glitchMapContrast = 3.5;
                    }
                }
                eff._frozen = active;
                cur = fx_pass_glitchdog(F, cur, eff, t, st);
                break;
            }
            case "dimensionSlash":
                cur = fx_pass_dimslash(F, cur, eff, t);
                break;
            case "lightBand":
                cur = fx_pass_lightband(F, cur, eff, t);
                break;
            // case "kaleido" 不在这里：万花筒是背景层的黑幕材质（fx_layer_bg）
        }
    }
    return cur;
};

const fx_render = (src_canvas, t, bg_canvas) => {
    const F = C.fx;
    const gl = F.gl;
    const pf = C.postfx;
    const K = pf ? pf.curves : null;

    const eff = C.fx_eff;
    /* 分层模式（F5 后：异象 **或** 带方块的谱）：bg_canvas=只有曲绘的背景画布，
       src_canvas=判定线+note 层。背景层先入 tex[0] 走 disabled/黑幕/kaleido/网格，
       再把 note 层 alpha-over 合回来 —— disabled 因此回到 note/线之下
       （原版 BackCanvas B/2 层序，audit F5，2026-10-06 修复）。
       无 bg_canvas（非异象且无方块 / fx 不可用）照旧整帧入 tex[0]。 */
    const split = !!bg_canvas;

    gl.bindTexture(gl.TEXTURE_2D, F.tex[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
                  split ? bg_canvas : src_canvas);

    let cur = 0;
    const run = (prog, setup) => {
        fx_pass(prog, F.tex[1 - cur], setup);
        cur = 1 - cur;
    };

    // ① disabled/ready 方块先压进背景场景（HANDOFF §10.1：compose → layers）。
    //    fx_cov 只吃 canvas mask（block_cv/block_sub_cv，render_scene 里画的），与层序无关；
    //    bLayers 把 disabled 填色烘进 tex —— 在异象分层里它必须在黑幕/kaleido/网格**之前**，
    //    对应原版 BackCanvas(B/2) 在 effect Canvas(B/3) 之下（audit §2.1 层序）。
    //    ★ active 方块（fx_blocks）不在这里跑：原版走主相机 CameraEvent=18（BeforeImageEffects），
    //      快照 = 已含黑幕+判定线+note 的整帧，压在全部之上（audit F1，2026-10-06 修复）。
    //      split 模式（异象或普通方块谱）下它挪到 fg 合成之后（eff 分支 ④ / 下面 F5 分支）；
    //      非 split 只剩「无方块或 fx 不可用」—— tex[0] 本身就是含 note 的整帧。
    if (C.block_live) {
        const tx = t / 20;
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

        // 非分层路径（bg_canvas=null）：快照 + active 在这里（原顺序）；
        // split 路径（异象或普通方块谱）挪到 fg 合成之后（eff 分支 ④ / 下面 F5 分支）。
        if (!bg_canvas) {
            const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];   // 必须与 apply_postfx 的 set(scene6) 同表达式
            fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);
            fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
            cur = 1 - cur;
        }
    }

    /* 首玩异象（Chapter9 baseline 的 LevelEffects）走独立分支：
       pass 顺序 = prefab 里settings 字段的声明顺序，各曲线用 director_eval。
       ★ fx_render_anomaly 沿用 run() 的约定：画面始终在 tex[cur]。 */
    if (eff) {
        if (split) {
            // ① 背景层效果（黑幕/kaleido/网格）—— 作用在曲绘+disabled 方块上，note 还没进来
            cur = fx_layer_bg(F, cur, eff, t);
            // ② 判定线+note 层盖回来（新建的 alpha-over 一趟）
            gl.bindTexture(gl.TEXTURE_2D, F.fg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src_canvas);
            fx_pass(F.prog.over, F.tex[1 - cur], (p, g) => {
                fx_bind(g, 0, F.tex[cur], p.loc.u_base);
                fx_bind(g, 1, F.fg, p.loc.u_over);
            });
            cur = 1 - cur;
            // ④ active 方块 = 原版 CameraEvent 18：对含【曲绘+disabled+黑幕/kaleido/网格+线+note】
            //    的整帧快照做合成，压在全部之上（fix audit F1：之前垫底 ⇒ Message 黑幕≡1 时
            //    方块整曲被吞、DS 前 65s 被 0.8 黑幕压暗 80%）。scene6 快照同步后移，
            //    apply 的 hue 源因此含 note/黑幕（audit §2.3 第 2 行「内容缺失」一并修正）。
            if (C.block_live) {
                const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];
                fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);
                fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
                cur = 1 - cur;
            }
        }
        // ③ 整帧后处理链（lightBand/glitch/... 照旧跑在合成后的画面上）
        cur = fx_render_anomaly(F, cur, eff, t);
        /* 约定与 run()/下面非异象分支一致：每次 pass 写 tex[1-cur] 后 cur = 1-cur，
           所以返回时画面在 tex[cur]，copy 必须读 tex[cur]。
           之前读 1-cur：0 个 pass 时读到上一帧残留（整屏黑），
           有 pass 时则永远丢掉最后一趟效果。 */
        fx_pass(F.prog.copy, null, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src));
        return;
    }

    /* F5（audit 2026-10-06 修复）：非异象但走分层的谱（普通方块谱）——
       ① 判定线+note 层 alpha-over 盖回「曲绘+disabled」之上；
       ② scene6 快照 + active 方块压在最上（与 eff split 分支 ④ 同序：
          原版 active 走 CameraEvent=BeforeImageEffects，快照含 note/线）。 */
    if (split) {
        gl.bindTexture(gl.TEXTURE_2D, F.fg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src_canvas);
        fx_pass(F.prog.over, F.tex[1 - cur], (p, g) => {
            fx_bind(g, 0, F.tex[cur], p.loc.u_base);
            fx_bind(g, 1, F.fg, p.loc.u_over);
        });
        cur = 1 - cur;
        if (C.block_live) {
            const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];
            fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);
            fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
            cur = 1 - cur;
        }
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
        fx_bind(g, 1, F.noiseRT, p.loc.u_noiseTex);
        g.uniform1f(p.loc.u_radius, curve_val(K.vignetteRadius, t));
        g.uniform1f(p.loc.u_smooth, curve_val(K.vignetteSmoothness, t));
        g.uniform1f(p.loc.u_darkness, curve_val(K.vignetteDarkness, t));
        g.uniform2f(p.loc.u_center, cc.vignetteCenter[0], cc.vignetteCenter[1]);
        /* 非异象谱不开噪声/扫描线（postfx.json 里也没有这组曲线；noiseRT 不会被采样）。 */
        g.uniform1f(p.loc.u_noiseBright, 0);
        g.uniform1f(p.loc.u_lineOpacity, 0);
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

const apply_postfx = (src, dst, t, bg) => {
    const dctx = dst.getContext("2d");
    const w = dst.width, h = dst.height;

    // 视口可能瞬时为 0（隐藏 / 最小化）。这时候不能往下走：GL canvas 会被缩到 0x0，
    // 之后 drawImage 直接抛 InvalidStateError。
    if (!w || !h) return;

    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalAlpha = 1;
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, w, h);

    /* 分层降级：WebGL 用不了时 src 只有 note 层，必须先把背景画布垫上，
       否则黑屏（两层是 render() 分开画的）。 */
    const flat = () => {
        if (bg) dctx.drawImage(bg, 0, 0);
        dctx.drawImage(src, 0, 0);
    };

    if (!C.fx_enabled || C.fx_failed) {
        flat();
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
            flat();
            return;
        }
        // glitch / 方块噪声上传都已移出首建分支 → 统一走下面的守卫式上传
        // （audit F2：首建分支对「异象先建 C.fx」「切谱换 glitchTex」都不执行/不重传；
        //   2026-10-17：方块的 displace/spark 同款漏传 —— 位移变恒定偏移、火花点全灭）
    }

    const gl = C.fx.gl;
    /* F2：噪声图守卫式上传 —— 按 img 身份比对，换谱/异象互切自动重传；
       异象谱 C.glitch_img=null 时这里不动（glitch4in1 由 fx_load_anomaly 上传）。 */
    fx_upload_noise(C.fx, C.glitch_img);
    fx_upload_block(C.fx);
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

    fx_render(src, t, bg);
    dctx.drawImage(C.fx.canvas, 0, 0);
};

/* ---------------- 画布尺寸 ----------------
   所有渲染尺寸都从这两个函数走：resize_canvases 是唯一入口，
   resize_to_window 跟窗口走（onresize 与视频导出结束时都回到它）。
   视频导出期间会临时把画布切到导出分辨率（w×h 与 w/8 的方块 mask 画布）。 */
const resize_canvases = (w, h) => {
    cv.width = w;
    cv.height = h;
    C.scene_cv.width = w;
    C.scene_cv.height = h;
    C.bg_cv.width = w;
    C.bg_cv.height = h;
    // 方块 mask 按原版 RT 尺寸 w/8 × h/8 光栅化（HANDOFF §3.1：那几对 mask RT 全是
    // w/8、Point，compose 也跑在 /8 上）。>> 3 就是原版 Start 里的 v31>>3 / v32>>3。
    C.block_cv.width = Math.max(1, w >> 3);
    C.block_cv.height = Math.max(1, h >> 3);
    C.block_sub_cv.width = C.block_cv.width;
    C.block_sub_cv.height = C.block_cv.height;
};

const resize_to_window = () => {
    // 导出期间画布是导出分辨率，窗口 onresize 不许把它覆盖掉
    if (C.video_export_active) return;
    resize_canvases(window.innerWidth, window.innerHeight);
};

/* ---------------- 主渲染 ---------------- */

/* mode: undefined=整帧（普通谱）| "bg"=只画曲绘（异象分层的背景画布）|
   "fg"=只画判定线/note/打击特效+方块 mask（透明底）。 */
const render_scene = (sctx, t, mode) => {
    const [w, h] = [cv.width, cv.height];
    const note_width = w * 0.1234375;

    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, w, h);
    if (mode !== "fg") {
        sctx.drawImage(C.chart.image, 0, 0, w, h);
        sctx.fillRectEx(0, 0, w, h, "rgba(0, 0, 0, 0.6)");
    }
    if (mode === "bg") return;   // 背景画布到此为止；前景在另一张画布上画

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
                // 视频导出时不发声：导出比实时快，实时播放的打击音必然错位
                // （导出的音轨只有音乐，见「视频导出」一节），clicked 标记照置。
                if (!C.video_export_active) play_sound(C.click_sounds[note.type]);
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

                /* hold 体收缩量按【剩余时间】线性，不按 dist —— 原版 HoldControl::NoteMove
                   （@0x1D83314，2026-10-06 反编译）holding 分支直接写 SpriteRenderer 局部缩放：
                     y = note.speed × ((realTime + holdTime − nowTime) / 3.8 × 0.2) × LevelInformation.Speed
                   即「长度 ∝ 距 hold 结束的剩余秒数」，全程不读 floorPosition；
                   approach 分支（nowTime ≤ realTime）同式代入 remain=holdTime ⇒ 常量，点击瞬间严格连续。
                   旧实现用 min(0, note_fp) 按线的 floorPosition 消费：常规段（line 值 speed==note.speed）
                   两种算法等价看不出差别，但 999 冲刺（1 个128分音 value=999）会让 linefp 在 8ms 内
                   跳过整段 fp-span ⇒ 点击后 body 秒塌 = 「部分长条打击后就消失」
                   （Message SP t≈22.9/24.3/25.1 三处，各叠两条 note）；负流速段则反过来只缩不完。
                   修法：clicked 起用 (t−sect)/secht 线性收缩，未点击保持全长。 */
                const hold_full = note.hold_length * h;
                const hold_shrink = note.clicked
                    ? hold_full * Math.min(1, Math.max(0, (t - note.sect) / Math.max(note.secht, 1e-6)))
                    : 0;
                const note_body_height = Math.max(
                    hold_full
                    - hold_shrink
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

/* 渲染「某一时刻」的一帧。时间轴 = get_time() 域（秒，即音乐秒），内部再减谱面 offset。
   实时播放（render）与视频导出（export_video）都走这一条路径 —— 导出画面 == 播放画面。 */
const render_frame_at = (t_raw) => {
    if (!cv.width || !cv.height) return;
    const t = t_raw - C.chart.data.offset;
    update_game_score(t);
    /* 异象分层：黑幕/kaleido/网格在原版挂在 SortingLayer=Background 的
       effect Canvas 上（画在判定线/note 之下），所以场景拆成
       「背景（曲绘）」与「判定线+note」两张画布分别进 GL。 */
    /* F5（audit 2026-10-06 修复）：不只异象 —— 任何带方块的谱也分层，
       否则非 split 路径会把 disabled 方块烘进含 note/判定线的整帧
       （原版 BackCanvas B/2 在判定线/note 之下）。无方块谱仍整帧。 */
    const has_blocks = !!(C.chart.blocks && C.chart.blocks.length);
    const split = !!((C.fx_eff || has_blocks) && C.fx && C.fx_enabled && !C.fx_failed);
    if (split) {
        render_scene(C.bg_cv.getContext("2d"), t, "bg");
        render_scene(C.scene_cv.getContext("2d"), t, "fg");
    } else {
        render_scene(C.scene_cv.getContext("2d"), t);
    }
    apply_postfx(C.scene_cv, cv, t, split ? C.bg_cv : null);
    draw_game_hud(t_raw);
};

const render = () => {
    // rAF 必须无条件续上：以前它排在最后，一帧抛异常整条渲染循环就死了，画面永远黑屏
    try {
        // 视频导出期间由 export_video 逐帧驱动，这里让位（否则两边抢同一张画布，
        // 也会把导出帧的时间戳搅乱）
        if (!C.video_export_active) {
            const t_raw = get_time();
            render_frame_at(t_raw);
            update_progress(t_raw - C.chart.data.offset);
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

/* ---------------- 视频导出 ----------------
   把当前谱面离线逐帧渲染成 WebM（VP9/VP8 + Opus）。为什么这么做：

   1. 不跟真实时钟走：每帧直接调 render_frame_at(t)（与「seek 后手动 render()」同一条
      管线），帧号 → 时间戳精确可复现；机器快就导出快，不会因为是实时的而丢帧。
   2. 编码走 WebCodecs（VideoEncoder + AudioEncoder），时间戳由我们自己写死（i/fps），
      输出是严格 CFR；不走 MediaRecorder（它只能边放边录，时间戳跟墙钟抖动）。
   3. 封装是这个文件里的最小 WebM（EBML/Matroska）写入器，不引第三方库：
      整文件在内存里攒完一次性成 Blob，所有元素尺寸精确写出；不写 SeekHead
      （与 MediaRecorder 产物同档，Chrome/ffmpeg 都能播能拖），Cues 写全
      （每个视频关键帧一条），拖进度条靠它。
   4. 音频不走实时采样：OfflineAudioContext 把 music.ogg 重采样到 48k 后整段切片
      喂 Opus 编码器 —— 音视频时间戳同源，天然对齐。
      打击音（WebAudio 实时播放那套）不进导出：导出比实时快，实时音必然错位；
      录像对照要的是「音乐 vs 画面」，不是「游戏音效」。
   5. 导出期间画布临时切到目标分辨率（resize_canvases），结束后恢复窗口尺寸
      （resize_to_window）；render() 由 C.video_export_active 让位。

   控制台/脚本用法（_analysis 的 eval 工作流可直接调）：
     const blob = await export_video({ width: 1280, height: 720, fps: 60,
                                       start: 0, end: 172, audio: true, bitrate: 5 });
   start/end 单位秒、与播放时钟同域（音频秒）；bitrate 单位 Mbps（缺省按分辨率自动）。
   返回值同时挂在 video_export.blob 上；面板「开始导出」= 调它 + 触发下载。

   内存：整段编码数据 + 最终 Blob 同时在内存里，峰值 ≈ 2× 文件大小
   （1080p60 三分钟约 200~250 MB 量级，属可接受；要更低就把码率调小）。 */

/* ---- 最小 WebM 写入器 ----
   EBML 基本元素就这几样，全部「已知尺寸」写出。IDs 按规范字节直接列。 */
const wb_utf8 = new TextEncoder();
const WEBM_ID = {
    ebml: [0x1A, 0x45, 0xDF, 0xA3],
    ebml_version: [0x42, 0x86], ebml_read_version: [0x42, 0xF7],
    ebml_max_id: [0x42, 0xF2], ebml_max_size: [0x42, 0xF3],
    doctype: [0x42, 0x82], doctype_version: [0x42, 0x87], doctype_read_version: [0x42, 0x85],
    segment: [0x18, 0x53, 0x80, 0x67],
    info: [0x15, 0x49, 0xA9, 0x66], timecode_scale: [0x2A, 0xD7, 0xB1],
    muxing_app: [0x4D, 0x80], writing_app: [0x57, 0x41], duration: [0x44, 0x89],
    tracks: [0x16, 0x54, 0xAE, 0x6B], track_entry: [0xAE], track_number: [0xD7],
    track_uid: [0x73, 0xC5], track_type: [0x83], flag_lacing: [0x9C],
    codec_id: [0x86], codec_private: [0x63, 0xA2], codec_delay: [0x56, 0xAA],
    seek_pre_roll: [0x56, 0xBB], default_duration: [0x23, 0xE3, 0x83],
    video: [0xE0], flag_interlaced: [0x9A], pixel_width: [0xB0], pixel_height: [0xBA],
    audio: [0xE1], sampling_freq: [0xB5], channels: [0x9F],
    cluster: [0x1F, 0x43, 0xB6, 0x75], timecode: [0xE7], simple_block: [0xA3],
    cues: [0x1C, 0x53, 0xBB, 0x6B], cue_point: [0xBB], cue_time: [0xB3],
    cue_positions: [0xB7], cue_track: [0xF7], cue_cluster_pos: [0xF1]
};

/* 拼接若干 Uint8Array（可嵌套数组 / 跳过 null），一次性分配 */
const cat_bytes = (...arrs) => {
    const flat = [];
    const push = a => {
        if (a == null) return;
        if (a instanceof Uint8Array) { flat.push(a); return; }
        for (const x of a) push(x);
    };
    push(arrs);
    let n = 0;
    for (const b of flat) n += b.length;
    const out = new Uint8Array(n);
    let off = 0;
    for (const b of flat) { out.set(b, off); off += b.length; }
    return out;
};

/* EBML 变长整数（元素尺寸、SimpleBlock 里的轨道号）。全 1 模式是「未知尺寸」保留值，
   所以可用上界是 2^(7·len)−2，按此选最短长度。 */
const wb_vint = v => {
    for (let len = 1; len <= 8; len++) {
        const max = Math.pow(2, 7 * len) - 1;
        if (v < max) {
            const out = new Uint8Array(len);
            let x = v;
            for (let i = len - 1; i >= 0; i--) { out[i] = x & 0xff; x = Math.floor(x / 256); }
            out[0] |= 1 << (8 - len);
            return out;
        }
    }
    throw new Error("webm: vint 溢出");
};

const wb_uint = n => {
    const out = [];
    let x = Math.max(0, Math.floor(n));
    do { out.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0);
    return Uint8Array.from(out);
};

const wb_f64 = n => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n);
    return b;
};

const wb_el = (id, ...payload) => {
    const body = cat_bytes(...payload);
    return cat_bytes(Uint8Array.from(id), wb_vint(body.length), body);
};

/* 写入器：add_video/add_audio 收 EncodedVideoChunk/EncodedAudioChunk（按时间戳归并
   入簇，见导出驱动的 pump），finish 出 Blob。
   簇切换：>4s / >4MB / 遇视频关键帧（导出每 2s 一个）——
   簇内 SimpleBlock 的相对时间戳是 int16 毫秒，4s 远在 ±32.7s 限内。
   frame_ns = 视频帧时长（ns），写进 TrackEntry/DefaultDuration —— 没有它
   ffprobe/播放器推不出帧率（实测 r_frame_rate 会变成 1000/1 这种怪值）。 */
const webm_writer = ({ width, height, video_codec, frame_ns, audio, duration_ms }) => {
    const clusters = [];
    const cues = [];            // { t: 关键帧 ms, cluster: 簇下标（簇未封口时 = clusters.length） }
    let cur = null;

    const new_cluster = ts => { cur = { ts, blocks: [], size: 0 }; };
    const seal_cluster = () => {
        if (!cur) return;
        clusters.push(wb_el(WEBM_ID.cluster,
            wb_el(WEBM_ID.timecode, wb_uint(cur.ts)), ...cur.blocks));
        cur = null;
    };
    const add_block = (track, ts_ms, key, data) => {
        if (!cur) new_cluster(ts_ms);
        const span = ts_ms - cur.ts;
        if (span > 4000 || cur.size > (4 << 20) || (track === 1 && key && cur.blocks.length && span > 0)) {
            seal_cluster();
            new_cluster(ts_ms);
        }
        const head = new Uint8Array(4);
        head[0] = 0x80 | track;                                   // 轨道号 vint（1/2 均单字节）
        new DataView(head.buffer).setInt16(1, ts_ms - cur.ts);
        head[3] = key ? 0x80 : 0;
        // ★ SimpleBlock = A3 + 尺寸 + [轨道号][int16 相对时间][flags][数据]。
        //   第一版漏了 wb_el 这层包装，把裸 payload 塞进簇 —— 文件结构自洽（尺寸都对），
        //   ffmpeg 也能认出轨道/时长，但一个 Block 都解不出来
        //   （_analysis\ebml_check.py 与 ffprobe 的 “0x00 at pos …” 警告就是这来的）。
        const blk = wb_el(WEBM_ID.simple_block, head, data);
        cur.blocks.push(blk);
        cur.size += blk.length;
        if (track === 1 && key) cues.push({ t: ts_ms, cluster: clusters.length });
    };
    const chunk_bytes = chunk => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        return b;
    };

    const finish = () => {
        seal_cluster();
        const info = wb_el(WEBM_ID.info,
            wb_el(WEBM_ID.timecode_scale, wb_uint(1000000)),     // 1 tick = 1ms
            wb_el(WEBM_ID.muxing_app, wb_utf8.encode("PhigrosWebPlayer")),
            wb_el(WEBM_ID.writing_app, wb_utf8.encode("PhigrosWebPlayer")),
            wb_el(WEBM_ID.duration, wb_f64(duration_ms)));
        const tracks_payload = [wb_el(WEBM_ID.track_entry,
            wb_el(WEBM_ID.track_number, wb_uint(1)),
            wb_el(WEBM_ID.track_uid, wb_uint(1)),
            wb_el(WEBM_ID.track_type, wb_uint(1)),
            wb_el(WEBM_ID.flag_lacing, wb_uint(0)),
            wb_el(WEBM_ID.codec_id, wb_utf8.encode(video_codec)),
            wb_el(WEBM_ID.default_duration, wb_uint(frame_ns)),  // ns/帧 → 帧率元数据
            wb_el(WEBM_ID.video,
                wb_el(WEBM_ID.flag_interlaced, wb_uint(2)),      // 2 = progressive
                wb_el(WEBM_ID.pixel_width, wb_uint(width)),
                wb_el(WEBM_ID.pixel_height, wb_uint(height))))];
        if (audio) {
            tracks_payload.push(wb_el(WEBM_ID.track_entry,
                wb_el(WEBM_ID.track_number, wb_uint(2)),
                wb_el(WEBM_ID.track_uid, wb_uint(2)),
                wb_el(WEBM_ID.track_type, wb_uint(2)),
                wb_el(WEBM_ID.flag_lacing, wb_uint(0)),
                wb_el(WEBM_ID.codec_id, wb_utf8.encode("A_OPUS")),
                wb_el(WEBM_ID.codec_private, audio.codec_private),
                wb_el(WEBM_ID.codec_delay, wb_uint(audio.codec_delay_ns)),
                wb_el(WEBM_ID.seek_pre_roll, wb_uint(80000000)), // Opus 规范值 80ms
                wb_el(WEBM_ID.audio,
                    wb_el(WEBM_ID.sampling_freq, wb_f64(48000)),
                    wb_el(WEBM_ID.channels, wb_uint(audio.channels)))));
        }
        const tracks = wb_el(WEBM_ID.tracks, ...tracks_payload);

        // Cues 的簇位置 = 相对 Segment 数据起点（Info/Tracks 之后）的字节偏移；
        // 此时所有簇都已封口，尺寸全知
        let off = info.length + tracks.length;
        const cl_off = clusters.map(c => { const o = off; off += c.length; return o; });
        const cues_el = wb_el(WEBM_ID.cues, ...cues.map(q => wb_el(WEBM_ID.cue_point,
            wb_el(WEBM_ID.cue_time, wb_uint(q.t)),
            wb_el(WEBM_ID.cue_positions,
                wb_el(WEBM_ID.cue_track, wb_uint(1)),
                wb_el(WEBM_ID.cue_cluster_pos, wb_uint(cl_off[q.cluster]))))));

        // Segment 头单独写（尺寸 = 其后全部内容）；其余全部作为 Blob 分片拼装，
        // 避免再整体复制一份
        const seg_head = cat_bytes(Uint8Array.from(WEBM_ID.segment), wb_vint(off + cues_el.length));
        const head = wb_el(WEBM_ID.ebml,
            wb_el(WEBM_ID.ebml_version, wb_uint(1)),
            wb_el(WEBM_ID.ebml_read_version, wb_uint(1)),
            wb_el(WEBM_ID.ebml_max_id, wb_uint(4)),
            wb_el(WEBM_ID.ebml_max_size, wb_uint(8)),
            wb_el(WEBM_ID.doctype, wb_utf8.encode("webm")),
            wb_el(WEBM_ID.doctype_version, wb_uint(4)),          // VP9 需要 ≥4（VP8 也兼容）
            wb_el(WEBM_ID.doctype_read_version, wb_uint(2)));
        const blob = new Blob([head, seg_head, info, tracks, ...clusters, cues_el],
                              { type: "video/webm" });
        clusters.length = 0;   // Blob 已复制，释放引用给 GC
        return blob;
    };

    return {
        add_video: chunk => add_block(1, Math.round(chunk.timestamp / 1000),
                                      chunk.type === "key", chunk_bytes(chunk)),
        add_audio: chunk => add_block(2, Math.round(chunk.timestamp / 1000),
                                      true, chunk_bytes(chunk)),
        finish
    };
};

/* ---- 导出驱动 ---- */

const video_export = {
    blob: null, name: "", done: 0, total: 0, status: "", error: null, perf0: 0
};

/* 让出主线程一拍。不能用 setTimeout：后台标签页里被节流到 ≥1s，
   导出会退化成 1 帧/秒。MessageChannel 不受节流，而且必须是宏任务级让步 ——
   await 一个已 resolve 的 promise 只清微任务队列，浏览器/工具消息永远进不来。 */
const yield_tick = () => new Promise(resolve => {
    const mc = new MessageChannel();
    mc.port1.onmessage = () => { mc.port1.close(); resolve(); };
    mc.port2.postMessage(0);
});

/* 每帧必让出（不是只在积压时让）：渲染一帧是同步大块，若编码器跟得上、
   队列不积压，这个函数此前会直接返回 —— 整个导出循环变成一条微任务长链，
   主线程被焊死（本轮实测：连 1+1 的评估都进不来）。另外顺带兜底：
   编码器出错/被取消时别在这里空转。 */
const wait_encoder = async (enc, abort_check) => {
    do {
        if (abort_check) abort_check();
        await yield_tick();
    } while (enc.encodeQueueSize > 8);
};

/* 导出/跳转预置：t0 是音乐秒，先减谱面 offset，clicked ⇔ sect < 谱面秒。
   预置可避免补播历史打击音，并让跨起点的 Hold 立即按已命中的状态收缩。 */
const preclick_notes = t0 => {
    const t = t0 - C.chart.data.offset;
    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) note.clicked = note.sect < t;
    }
};

const export_filename = (w, h, fps) => {
    const info = C.chart.info || {};
    const dir = String(C.chart.dir || "").split("/").filter(Boolean).pop() || "";
    const base = [info.name || "chart", dir, `${w}x${h}`, `${fps}fps`]
        .filter(Boolean).join("_").replace(/[\\/:*?"<>|]/g, "_");
    const d = new Date();
    const p2 = n => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
                  `_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    return `${base}_${stamp}.webm`;
};

/* 音频轨：music.ogg → 48k 立体声 [t0, t1) 段（OfflineAudioContext 离线重采样，
   比实时快得多；t0 超曲长则整段静音）。url 走 <audio> 元素同一地址，命中 HTTP 缓存。 */
const render_audio_48k = async (url, t0, t1) => {
    const buf = await load_audio(url);
    const sr = 48000;
    const len = Math.max(1, Math.ceil((t1 - t0) * sr));
    const off = new OfflineAudioContext(2, len, sr);
    if (buf && t0 < buf.duration) {
        const src = off.createBufferSource();
        src.buffer = buf;
        src.start(0, t0, Math.max(0, Math.min(t1, buf.duration) - t0));
        src.connect(off.destination);
    }
    return await off.startRendering();
};

/* Opus 编码：20ms 一帧（960 样点）。时间戳从 0 起（与视频同源）。
   decoderConfig.description 就是 OpusHead，留作 CodecPrivate；没有就手搓兜底。 */
const opus_head_fallback = channels => {
    const b = new Uint8Array(19);
    b.set(wb_utf8.encode("OpusHead"), 0);
    b[8] = 1;                                        // version
    b[9] = channels;
    const dv = new DataView(b.buffer);
    dv.setUint16(10, 312, true);                     // pre-skip（libopus 默认 6.5ms）
    dv.setUint32(12, 48000, true);                   // 原始采样率
    dv.setUint16(16, 0, true);                       // 输出增益
    b[18] = 0;                                       // 声道映射族 = 0（单流）
    return b;
};

const encode_audio_48k = async rendered => {
    const chunks = [];
    const out = { desc: null, error: null, channels: rendered.numberOfChannels };
    const enc = new AudioEncoder({
        output: (chunk, meta) => {
            const d = meta && meta.decoderConfig && meta.decoderConfig.description;
            if (d && !out.desc) out.desc = new Uint8Array(d);
            chunks.push(chunk);
        },
        error: e => { out.error = e; }
    });
    enc.configure({
        codec: "opus", sampleRate: 48000,
        numberOfChannels: out.channels, bitrate: 128000
    });
    const FRAME = 960;                               // 20ms @48k
    const planes = [];
    for (let c = 0; c < out.channels; c++) planes.push(rendered.getChannelData(c));
    let n_chunk = 0;
    for (let pos = 0; pos < rendered.length; pos += FRAME) {
        if (out.error) break;
        const n = Math.min(FRAME, rendered.length - pos);
        const planar = new Float32Array(n * out.channels);
        for (let c = 0; c < out.channels; c++) {
            planar.set(planes[c].subarray(pos, pos + n), c * n);
        }
        const ad = new AudioData({
            format: "f32-planar", sampleRate: 48000,
            numberOfFrames: n, numberOfChannels: out.channels,
            timestamp: Math.round(pos / 48000 * 1e6), data: planar
        });
        enc.encode(ad);
        ad.close();
        n_chunk++;
        if ((n_chunk & 127) === 0) await yield_tick();   // 长曲也别把主线程焊住
        if (enc.encodeQueueSize > 16) await wait_encoder(enc);
    }
    await enc.flush().catch(e => { out.error = out.error || e; });
    enc.close();
    chunks.sort((a, b) => a.timestamp - b.timestamp);
    return { chunks, desc: out.desc, error: out.error, channels: out.channels };
};

const export_video = async (opt = {}) => {
    if (C.video_export_active) throw new Error("已有导出任务在跑");
    if (!C.chart || !C.chart.data || !C.chart.data.judgeLineList) throw new Error("尚未载入谱面");
    if (!window.VideoEncoder) throw new Error("此浏览器不支持 WebCodecs（VideoEncoder）");

    const m = C.chart.music;
    const fps = Math.min(120, Math.max(1, Math.round(opt.fps || 60)));
    const w = Math.max(64, Math.round((opt.width || 1920) / 2) * 2);
    const h = Math.max(64, Math.round((opt.height || 1080) / 2) * 2);
    const dur = C.chart.duration || 0;
    const start = Math.max(0, opt.start != null ? +opt.start : 0);
    let end = opt.end != null ? +opt.end : dur;
    if (!(end > start)) end = Math.max(dur, start + 1);
    end = Math.min(end, Math.max(dur, start) + 10);          // 尾部最多多渲 10s
    const total = Math.max(1, Math.ceil((end - start) * fps));
    const mbps = opt.bitrate > 0 ? +opt.bitrate
                                 : Math.max(1, w * h * fps * 0.08 / 1e6);
    const bitrate = Math.round(mbps * 1e6);
    const want_audio = !!opt.audio;

    const was_playing = clock.running || !!(m && !m.paused && !m.ended);
    const prev_pos = clock_t();

    C.video_export_active = true;
    video_export.blob = null; video_export.error = null;
    video_export.done = 0; video_export.total = total;
    video_export.status = "准备中…";
    video_export.perf0 = 0;

    let venc = null;
    try {
        if (m) pause();
        preclick_notes(start);
        /* 异象冻帧闩锁（glitchDog 的 freezeTime）：从冻结点之后开渲时预置成「已冻结」，
           否则「冻帧当帧」的亮度/对比度 snap 会错跑到片段第一帧。 */
        if (C.fx_eff && C.fx_eff.scalars && C.fx_eff.scalars.freezeTime != null) {
            C.fx_eff._frozen = start >= C.fx_eff.scalars.freezeTime;
        }
        resize_canvases(w, h);
        render_frame_at(start);          // 预热：RT 按新尺寸重建、贴图上传（不计进度）

        // ---- 音频轨：先离线渲完、编码完（几秒钟的活），chunks 攒着等视频同步入封装 ----
        const aq = [];
        let audio_meta = null;
        if (want_audio && m && typeof AudioEncoder === "function") {
            try {
                video_export.status = "渲染音频…";
                export_ui_progress(true);
                const rendered = await render_audio_48k(m.currentSrc || m.src, start, end);
                video_export.status = "编码音频…";
                export_ui_progress(true);
                const out = await encode_audio_48k(rendered);
                if (out.error) throw out.error;
                if (out.chunks.length) {
                    const head = out.desc || opus_head_fallback(out.channels);
                    const preskip = (head && head.length >= 12) ? (head[10] | (head[11] << 8)) : 312;
                    audio_meta = {
                        channels: out.channels,
                        codec_private: head,
                        codec_delay_ns: Math.round(preskip / 48000 * 1e9)
                    };
                    aq.push(...out.chunks);
                }
            } catch (e) {
                console.warn("音频轨导出失败，继续无音轨导出：", e);
                aq.length = 0;
                audio_meta = null;
            }
        }

        // ---- 视频轨编码器：VP9 优先，退 VP8 ----
        video_export.status = "探测编码器…";
        export_ui_progress(true);
        let vcodec = null;
        for (const c of ["vp09.00.10.08", "vp8"]) {
            try {
                const s = await VideoEncoder.isConfigSupported({
                    codec: c, width: w, height: h, bitrate, framerate: fps
                });
                if (s.supported) { vcodec = c; break; }
            } catch (e) { /* 不支持就试下一个 */ }
        }
        if (!vcodec) throw new Error("此浏览器没有可用的 VP9/VP8 编码器");

        const gw = webm_writer({
            width: w, height: h,
            video_codec: vcodec.startsWith("vp09") ? "V_VP9" : "V_VP8",
            frame_ns: Math.round(1e9 / fps),
            audio: audio_meta,
            duration_ms: (end - start) * 1000      // 先写进 Info：播放器看时长靠它
        });

        const vq = [];
        let venc_err = null;
        /* 按时间戳归并两轨再入封装，保证同一簇内块的时间单调
           （音轨在视频之前整段就绪，只是在这里被拉平节奏） */
        const pump = () => {
            while (vq.length) {
                if (aq.length && aq[0].timestamp <= vq[0].timestamp) gw.add_audio(aq.shift());
                else gw.add_video(vq.shift());
            }
        };
        venc = new VideoEncoder({
            output: chunk => { vq.push(chunk); pump(); },
            error: e => { venc_err = e; }
        });
        venc.configure({
            codec: vcodec, width: w, height: h, bitrate, framerate: fps,
            latencyMode: "quality"
        });

        video_export.status = "渲染视频…";
        video_export.perf0 = performance.now();
        const frame_us = 1e6 / fps;
        const key_every = Math.max(1, Math.round(fps * 2));    // 2s 一个关键帧（也决定簇节奏）
        for (let i = 0; i < total; i++) {
            if (C.video_export_cancelled) throw new Error("已取消");
            if (venc_err) throw venc_err;
            render_frame_at(start + i / fps);
            const frame = new VideoFrame(cv, {
                timestamp: Math.round(i * frame_us),
                duration: Math.round(frame_us),
                alpha: "discard"
            });
            venc.encode(frame, { keyFrame: i % key_every === 0 });
            frame.close();
            video_export.done = i + 1;
            export_ui_progress();
            // 每帧让出（见 wait_encoder 注释）+ 背压；取消/编码器错误在这里抛
            await wait_encoder(venc, () => {
                if (C.video_export_cancelled) throw new Error("已取消");
                if (venc_err) throw venc_err;
            });
        }
        await venc.flush();
        pump();
        while (aq.length) gw.add_audio(aq.shift());

        video_export.status = "封装中…";
        export_ui_progress(true);
        video_export.blob = gw.finish();
        video_export.name = export_filename(w, h, fps);
        video_export.status = "完成";
        export_ui_progress(true);
        return video_export.blob;
    } catch (e) {
        video_export.error = e;
        throw e;
    } finally {
        try { if (venc && venc.state !== "closed") venc.close(); } catch (e) {}
        C.video_export_active = false;
        C.video_export_cancelled = false;
        resize_to_window();
        clock_seek(prev_pos);
        preclick_notes(prev_pos);
        update_progress(prev_pos);
        // 立刻按窗口尺寸重画一帧（后台标签页 rAF 可能被挂起，不能等它）
        try { render_frame_at(clock_t()); } catch (e) {}
        export_ui_progress(true);
        if (was_playing && C.chart.music) { try { play(); } catch (e) {} }
    }
};

/* ---- 导出面板 ---- */

let export_ui_last = 0;
const fmt_hms = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const export_ui_progress = force => {
    const now = performance.now();
    if (!force && now - export_ui_last < 120) return;    // 别每帧都摸 DOM
    export_ui_last = now;
    const ve = video_export;
    const pct = ve.total ? ve.done / ve.total : 0;
    ui.export_progress_fill.style.width = `${(pct * 100).toFixed(2)}%`;
    let txt = ve.status || "";
    if (ve.done && ve.perf0) {
        const sec = (now - ve.perf0) / 1000;
        const sp = sec > 0.5 ? ve.done / sec : 0;
        if (sp > 0) {
            const eta = Math.max(0, (ve.total - ve.done) / sp);
            txt += ` ${ve.done}/${ve.total} 帧 · ${sp.toFixed(1)} 帧/秒 · 剩余 ${fmt_hms(eta)}`;
        } else {
            txt += ` ${ve.done}/${ve.total} 帧`;
        }
    }
    ui.export_status.textContent = txt;
};

const export_open = () => !ui.export_overlay.classList.contains("hidden");

const auto_bitrate = (w, h, fps) => Math.max(1, Math.round(w * h * fps * 0.08 / 1e6));

const export_collect_opt = () => ({
    width: parseInt(ui.export_w.value, 10) || 1920,
    height: parseInt(ui.export_h.value, 10) || 1080,
    fps: parseInt(ui.export_fps.value, 10) || 60,
    bitrate: parseFloat(ui.export_bitrate.value) || 0,
    start: Math.max(0, parseFloat(ui.export_start.value) || 0),
    end: (parseFloat(ui.export_end.value) > 0)
        ? parseFloat(ui.export_end.value) : (C.chart.duration || 0),
    audio: ui.export_audio.checked
});

const export_est_update = () => {
    const o = export_collect_opt();
    const dur = Math.max(0, o.end - o.start);
    const n = Math.max(1, Math.ceil(dur * o.fps));
    const mbps = o.bitrate > 0 ? o.bitrate : auto_bitrate(o.width, o.height, o.fps);
    const mb = mbps * 1e6 / 8 * dur / 1048576;
    ui.export_est.textContent =
        `约 ${n} 帧 · ${mbps} Mbps${o.bitrate > 0 ? "" : "（自动）"} · 预计 ${mb.toFixed(0)} MB`;
};

const open_export_panel = () => {
    if (export_open() || C.video_export_active || lib_loading) return;
    if (!C.chart || !C.chart.data) return;
    pause();
    ui.start_overlay.classList.add("hidden");
    ui.export_end.value = (C.chart.duration || 0).toFixed(2);
    ui.export_bitrate.value = auto_bitrate(
        parseInt(ui.export_w.value, 10) || 1920,
        parseInt(ui.export_h.value, 10) || 1080,
        parseInt(ui.export_fps.value, 10) || 60);
    ui.export_progress_wrap.classList.add("hidden");
    ui.export_status.textContent = "";
    export_est_update();
    ui.export_overlay.classList.remove("hidden");
};

const close_export_panel = () => {
    if (!export_open() || C.video_export_active) return;
    ui.export_overlay.classList.add("hidden");
    if (!chart_started) ui.start_overlay.classList.remove("hidden");
};

const export_cancel = () => {
    if (!C.video_export_active) return;
    C.video_export_cancelled = true;
    ui.export_status.textContent = "正在取消…";
};

const export_run_ui = async () => {
    if (C.video_export_active) return;
    ui.export_go.disabled = true;
    ui.export_cancel.disabled = false;
    ui.export_progress_wrap.classList.remove("hidden");
    ui.export_status.textContent = "准备中…";
    try {
        const blob = await export_video(export_collect_opt());
        ui.export_status.textContent =
            `完成：${video_export.name}（${(blob.size / 1048576).toFixed(1)} MB），开始下载`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = video_export.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 120000);
    } catch (e) {
        ui.export_status.textContent = `导出失败：${(e && e.message) || e}`;
        console.error("视频导出失败：", e);
    } finally {
        ui.export_go.disabled = false;
        ui.export_cancel.disabled = true;
    }
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

    init_game_score();
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

const load_chart = async (dir, assetDir, anomaly) => {
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
    ui.loading_label.textContent = "正在加载谱面";
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

    /* ★ init_chart 必须在下面的 await 之前：C.chart 已换成新谱面，
       渲染循环（rAF）是并发跑的，若异步窗口里 line 还没挂上 get_state/sec2beat，
       每帧都会抛 "line.get_state is not a function"（切异象谱时实测刷了一串）。
       init_chart 不引用 fx/fx_eff，fx_load_anomaly 不引用 C.chart —— 顺序可安全互换。 */
    init_chart();

    /* 首玩异象：清掉上一首的，再按需载入。异象与 s6 那套 postfx 互斥
       （fx_render 里优先走 eff 分支）。anomaly 来自 index.json 的条目，
       可用 URL 参数 ?noanomaly=1 强制关掉。 */
    C.fx_eff = null;
    if (anomaly && !/[?&]noanomaly=1/.test(location.search)) {
        try {
            await fx_load_anomaly(anomaly);
        } catch (e) {
            C.fx_eff = null;
            console.warn("异象载入失败，回退普通画面:", e);
        }
    }

    clock_run(false);
    ui.btn_play.textContent = ">";
    ui.loading_overlay.classList.add("hidden");
};

/* ---------------- 自动演奏计分 ----------------
   ScoreControl.Update @0x1D87A1C：普通模式
   score = (perfect + 0.65*good)/总note数*900000 + maxcombo/总note数*100000。
   当前播放器所有 note 都自动 Perfect；每个 note 只结算一次，Hold 中途特效不计分。
   HoldControl.Judge @0x1D83B50：已命中的 Hold 在尾端前0.22秒结算，且不能早于头部命中。
   使用排序后的结算时间二分查找，结果仅由当前谱面时间决定：倒退、跳转、重复绘制和
   非零起点的视频导出都不依赖 clicked 或此前渲染过多少帧。 */
const init_game_score = () => {
    const times = [];
    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) {
            times.push(note.is_hold ? Math.max(note.sect, note.hold_end_time - 0.22) : note.sect);
        }
    }
    times.sort((a, b) => a - b);
    C.chart.scoring = { times, total: times.length, perfect: 0, combo: 0, max_combo: 0, score: 0 };
    update_game_score(-Infinity);
};

const update_game_score = t => {
    const scoring = C.chart.scoring;
    if (!scoring) return;
    let lo = 0, hi = scoring.total;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        // 与现有自动命中 note.sect < t 一致，边界当帧尚未结算。
        if (scoring.times[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    scoring.perfect = scoring.combo = scoring.max_combo = lo;
    // 原版使用 float32 分步计算并在显示时 +0.5 取整；不要逐 note 累加已取整的单价。
    const f = Math.fround;
    const base = scoring.total ? f(f(lo / scoring.total) * 900000) : 0;
    const bonus = scoring.total ? f(f(lo * 100000) / scoring.total) : 0;
    scoring.score = Math.min(1000000, Math.floor(f(f(base + bonus) + 0.5)));
    C.game_hud.score = scoring.score;
    C.game_hud.combo = scoring.combo;
};

/* ---------------- HUD ---------------- */

const load_game_hud = async () => {
    const font = new FontFace("PhiHUD", `url("${R("/res/hud/PhiHUD.ttf")}")`);
    await Promise.all([
        load_img(R("/res/hud/pause.png")).then(img => C.game_hud.imgs.pause = img),
        load_img(R("/res/hud/progress.png")).then(img => C.game_hud.imgs.progress = img),
        font.load().then(face => document.fonts.add(face)).catch(err => {
            console.warn("HUD 字体载入失败，使用备用字体：", err);
        })
    ]);
};

// Level.unity 的 HUD 是 World Space Canvas（局部比例 0.01），相机正交半高 5。
// 因此可见高度是 1000 个 UI 单位，CanvasScaler 的 1920×1080 / match=0.6 不参与屏幕适配。
// LevelUICont.Update @0x1D81B18 会覆盖四角元素的 localPosition，不能使用静态 anchoredPosition。
// UI 开场动画结束后父节点比例为 1；这里先复现正常游玩期间的布局。
const game_hud_layout = (w = cv.width, h = cv.height) => {
    const scale = h / 1000;
    const width = w / scale;
    const half_width = w / h >= 16 / 9 ? 888.888916015625 : width / 2;
    const left = width / 2 - half_width;
    const right = width / 2 + half_width;
    return { scale, width, height: 1000, half_width,
        // Pause pivot=(0.5,0.5)，Score pivot=(0.5,0.5)、宽400、MiddleRight。
        pause: { x: left + 50.589 - 34.262 / 2, y: 500 - 444.3 - 37.966 / 2,
            width: 34.262, height: 37.966 },
        score: { x: right - 237.39 + 200, y: 500 - 445.7 },
        combo: { x: width / 2, y: 500 - 452 },
        combo_text: { x: width / 2, y: 500 - 405 },
        // 底部两个 Rect 的 pivot 在底边，高46；Middle 对齐的文字中心比 pivot 高23。
        song: { x: left + 40, y: 500 + 473.2 - 23 },
        level: { x: right - 40, y: 500 + 473.2 - 23 },
        // ProgressControl.Update @0x1D8600C：pivot=(1,1)，右端 x=a*(2*p-1)、y=500。
        // 精灵本体宽1919、高11，横向平移后由窗口裁切，不按进度拉伸精灵。
        progress: { left, span: 2 * half_width, width: 1919, height: 11 } };
};

const draw_game_hud = t_raw => {
    if (!chart_started || lib_loading || library_open()) return;
    const hud = C.game_hud;
    const layout = game_hud_layout();
    ctx.save();
    ctx.setTransform(layout.scale, 0, 0, layout.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";

    // 原版进度取 nowTime / audioLength，nowTime = audioTime - 谱面 offset。
    const duration = C.chart.music.duration || C.chart.duration || 1;
    const progress = Math.max(0, Math.min(1, (t_raw - C.chart.data.offset) / duration));
    if (hud.imgs.progress && progress > 0) {
        const bar = layout.progress;
        ctx.drawImage(hud.imgs.progress, bar.left + bar.span * progress - bar.width,
            0, bar.width, bar.height);
    }
    const button = layout.pause;
    if (hud.imgs.pause) ctx.drawImage(hud.imgs.pause, button.x, button.y, button.width, button.height);

    const text = (value, size, align, x, y, max_width) => {
        const str = String(value);
        ctx.font = `${size}px PhiHUD, sans-serif`;
        const width = ctx.measureText(str).width;
        if (width > max_width) ctx.font = `${size * max_width / width}px PhiHUD, sans-serif`;
        ctx.textAlign = align;
        ctx.fillText(str, x, y);
    };
    text(String(Math.round(hud.score)).padStart(7, "0"), 50, "right", layout.score.x, layout.score.y, 400);
    if (hud.combo > 2) {
        text(hud.combo, 70, "center", layout.combo.x, layout.combo.y, 400);
        text("COMBO", 24, "center", layout.combo_text.x, layout.combo_text.y, 200);
    }
    const name_width = Math.min(650, Math.max(1, (layout.level.x - layout.song.x - 24) / 2));
    text(C.chart.info.name || "", 36, "left", layout.song.x, layout.song.y, name_width);
    text(C.chart.info.level || "", 36, "right", layout.level.x, layout.level.y, name_width);
    ctx.restore();
};

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
    // 跳过的 note 视为已自动命中，避免跳转后补播全部历史打击音。
    preclick_notes(v);
    update_game_score(v - C.chart.data.offset);
    update_progress(v);
};

/* ---------------- 底栏显隐 ---------------- */
// 底栏默认隐藏（index.html 的 #bottom-bar 初始就带 hidden），B 键切换：
// 播放时底栏会压住画面下沿，隐藏后更接近原版观感；要看进度/换谱时按 B 调出来。
const toggle_bottom_bar = () => ui.bottom_bar.classList.toggle("hidden");

/* ---------------- 谱面库 ---------------- */
let chart_started = false;
let render_started = false;
let lib_loading = false;

const library_open = () => !ui.library_overlay.classList.contains("hidden");

const open_library = () => {
    if (library_open() || lib_loading) return;
    pause();
    ui.start_overlay.classList.add("hidden");
    ui.library_close.disabled = !C.chart.data;
    ui.library_overlay.classList.remove("hidden");
};

const close_library = () => {
    // 首次启动还没有选谱，此时不能关闭到空白画面或显示无谱面的开始按钮。
    if (!library_open() || !C.chart.data) return;
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
        img.src = R(e.cover || `${e.path}/image.png`);

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
        // anomaly 来自 index.json：这三首 SP 首玩会带 LevelEffects 异象
        await load_chart(R(e.path), R(e.asset || e.path), e.anomaly);
        chart_started = false;
        ui.start_overlay.classList.remove("hidden");
    } catch (err) {
        console.error("谱面载入失败：", e.path, err);
        ui.start_overlay.classList.remove("hidden");
    }
    lib_loading = false;
};

const init_player = async () => {
    C.scene_cv = document.createElement("canvas");
    C.bg_cv = document.createElement("canvas");   // 异象分层：曲绘专用背景画布
    C.block_cv = document.createElement("canvas");
    C.block_sub_cv = document.createElement("canvas");

    resize_to_window();
    window.onresize = resize_to_window;
    document.addEventListener("fullscreenchange", resize_to_window);
    document.addEventListener("webkitfullscreenchange", resize_to_window);

    // 首次访问外网时资源可能很慢：立即显示启动进度，独立资源并行下载。
    // 每项最多等待60秒，失败时保留具体错误，避免所有浮层隐藏后的无提示黑屏。
    let boot_done = 0, boot_failed = false;
    const tasks = [
        ["res/click.ogg", async () => C.click_sounds[C.note.tap] = await load_audio(R("/res/click.ogg"))],
        ["res/drag.ogg", async () => C.click_sounds[C.note.drag] = await load_audio(R("/res/drag.ogg"))],
        ["res/flick.ogg", async () => C.click_sounds[C.note.flick] = await load_audio(R("/res/flick.ogg"))],
        ...["click", "drag", "hold", "flick", "click_mh", "drag_mh", "hold_mh", "flick_mh"].map(key =>
            [`res/${key}.png`, async () => C.note_imgs[key] = await load_img(R(`/res/${key}.png`))]),
        ["res/respack.json", async () => C.respack_info = await load_json(R("/res/respack.json"))],
        ["res/hit_fx.png", async () => C.hit_fx = await load_img(R("/res/hit_fx.png"))],
        ["res/BlockNoise1.png", async () => C.block.imgs.displace = await load_img(R("/res/BlockNoise1.png"))],
        ["res/PointNoise.png", async () => C.block.imgs.spark = await load_img(R("/res/PointNoise.png"))],
        ["HUD 字体和图标", load_game_hud],
        ["shader/ 着色器", load_shaders]
    ];
    const pending = new Set(tasks.map(([name]) => name));
    const boot_progress = () => {
        if (boot_failed) return;
        ui.loading_fill.style.width = `${boot_done / tasks.length * 100}%`;
        ui.loading_text.textContent = `${boot_done}/${tasks.length} · 等待 ${[...pending].join("、")}`;
    };
    boot_progress();
    await Promise.all(tasks.map(async ([name, load]) => {
        let timer;
        try {
            await Promise.race([
                load(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`加载超时：${name}`)), 60000);
                })
            ]);
            pending.delete(name);
            boot_done++;
            boot_progress();
        } catch (err) {
            boot_failed = true;
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }));
    C.click_sounds[C.note.hold] = C.click_sounds[C.note.tap];

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

    ui.loading_text.textContent = "正在加载谱面库…";
    const lib_manifest = await load_json_or_null(R("/res/library/index.json"));
    if (lib_manifest && Array.isArray(lib_manifest.charts) && lib_manifest.charts.length > 0) {
        render_library(lib_manifest.charts);
        open_library();
        // 所有设备启动后都停留在谱面库，用户选谱后才加载歌曲并显示 Click to start。
        ui.loading_overlay.classList.add("hidden");
    } else {
        await load_chart(R("/res/s6"));
        ui.library_count.textContent = "未导入：py import_library.py";
        ui.start_overlay.classList.remove("hidden");
    }

    ui.start_overlay.onclick = () => {
        // 在用户点击/按空格的同步调用中请求整页全屏，保留底栏与谱面库等浮层。
        // 不等待全屏结果：浏览器不支持或拒绝时仍按原流程开始播放。
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            const root = document.documentElement;
            const request = root.requestFullscreen || root.webkitRequestFullscreen;
            if (request) {
                try {
                    const result = request.call(root);
                    if (result && result.catch) result.catch(() => {});
                } catch (e) { /* 全屏不可用时继续窗口播放 */ }
            }
        }
        ui.start_overlay.classList.add("hidden");
        chart_started = true;
        play();
        if (!render_started) {
            render_started = true;
            render();
        }
    };

    ui.btn_play.onclick = toggle_play;

    // HUD 暂停图标复用播放器的播放/暂停操作；暂停菜单留待后续移植。
    cv.addEventListener("click", e => {
        if (!chart_started || lib_loading || library_open() || export_open() || C.video_export_active) return;
        const rect = cv.getBoundingClientRect();
        const layout = game_hud_layout();
        const x = (e.clientX - rect.left) * cv.width / rect.width / layout.scale;
        const y = (e.clientY - rect.top) * cv.height / rect.height / layout.scale;
        const button = layout.pause;
        if (x >= button.x - 12 && x <= button.x + button.width + 12 &&
            y >= button.y - 12 && y <= button.y + button.height + 12) toggle_play();
    });

    ui.btn_library.onclick = open_library;
    ui.library_close.onclick = close_library;
    ui.library_overlay.onclick = e => {
        if (e.target === ui.library_overlay) close_library();
    };

    /* 导出视频面板 */
    ui.btn_export.onclick = open_export_panel;
    ui.export_close.onclick = close_export_panel;
    ui.export_overlay.onclick = e => {
        if (e.target === ui.export_overlay) close_export_panel();
    };
    for (const key of ["export_w", "export_h", "export_fps", "export_bitrate", "export_start", "export_end"]) {
        ui[key].addEventListener("input", export_est_update);
    }
    ui.export_audio.addEventListener("change", export_est_update);
    ui.export_p720.onclick = () => { ui.export_w.value = "1280"; ui.export_h.value = "720"; export_est_update(); };
    ui.export_p1080.onclick = () => { ui.export_w.value = "1920"; ui.export_h.value = "1080"; export_est_update(); };
    ui.export_pwin.onclick = () => {
        ui.export_w.value = String(window.innerWidth);
        ui.export_h.value = String(window.innerHeight);
        export_est_update();
    };
    ui.export_whole.onclick = () => {
        ui.export_start.value = "0";
        ui.export_end.value = (C.chart.duration || 0).toFixed(2);
        export_est_update();
    };
    ui.export_here.onclick = () => {
        ui.export_start.value = clock_t().toFixed(2);
        ui.export_end.value = (C.chart.duration || 0).toFixed(2);
        export_est_update();
    };
    ui.export_go.onclick = export_run_ui;
    ui.export_cancel.onclick = export_cancel;

    ui.progress_wrap.onclick = e => {
        const r = ui.progress_wrap.getBoundingClientRect();
        seek((e.clientX - r.left) / r.width * C.chart.duration);
    };

    window.onkeydown = e => {
        if (C.video_export_active) {
            if (e.code === "Escape") { e.preventDefault(); export_cancel(); }
            return;                      // 导出期间锁输入：空格/方向键别去碰播放时钟
        }
        if (export_open()) {
            if (e.code === "Escape" || e.code === "Space") {
                e.preventDefault();
                close_export_panel();
            }
            return;
        }
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
        } else if (e.code === "KeyV") {
            open_export_panel();
        } else if (e.code === "KeyB") {
            toggle_bottom_bar();
        }
    };

    console.log(C);
};

window.onload = () => init_player().catch(err => {
    console.error("播放器启动失败：", err);
    ui.start_overlay.classList.add("hidden");
    ui.loading_overlay.classList.remove("hidden");
    ui.loading_label.textContent = "启动失败";
    ui.loading_text.textContent = `${err.message || err}（请检查网络后刷新页面）`;
});
