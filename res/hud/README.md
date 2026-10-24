# Gameplay HUD

资源来自 `4.0.1/ExportedProject/Assets/`：

- `PhiHUD.ttf`：`Font/Source Han Sans & Saira Hybrid-Regular_3.ttf`，未修改。
- `pause.png`、`progress.png`：从 `Texture2D/打歌界面与暂停 素材.png` 按 Sprite 资源的矩形裁切。
  Unity 原点在左下，裁图时转换为 PNG 左上原点；分数、Combo、曲名和难度为字体绘制。

布局依据 `Phigros2/Level/Level.unity` 与运行时 `LevelUICont.Update`（`0x1D81B18`）。
HUD 是 World Space Canvas，局部比例 0.01，相机正交半高 5，可见高度对应 1000 个 UI 单位，
屏幕缩放比例为 `height / 1000`；CanvasScaler 配置的 1920×1080 / match=0.6 不用于这个 Canvas 的屏幕适配。

四角位置按运行时代码求值，并计入 RectTransform 的 pivot 和文字框尺寸。
宽高比小于 16:9 时，暂停图标左上角距边约 `(33.458, 36.717)`，
分数右对齐点距右边 37.39、中心距顶 54.3，底部文字左右距边 40、中心距底 49.8（均为 UI 单位）。
宽高比达到 16:9 时，运行时代码将水平半宽钳至约 888.889；这里保留该规则。

进度条复现 `ProgressControl.Update`（`0x1D8600C` 起）的平移逻辑：
顶边位于窗口 y=0，精灵大小为 1919×11 UI 单位，右端位置从水平范围的左端移向右端，超出窗口的部分被裁切。
文字和图标共用一个缩放比例。尚未复刻开场动画、特殊曲目 UI 门控及 Unity Text 的逐字形栅格化。

分数和 Combo 跟随现有自动演奏：Tap / Drag / Flick 在命中后结算，Hold 在尾端前0.22秒结算
（短 Hold 最早在头部命中时结算），每个 note 计一次 Perfect 和 Combo。
普通模式计分公式来自 `ScoreControl.Update`（`0x1D87A1C`）：
`(Perfect + 0.65 × Good) / 总note数 × 900000 + 最大Combo / 总note数 × 100000`。
当前自动演奏全部为 Perfect；全曲结算完成时为 `1000000`，Combo ≥ 3 才显示数字和标签。
计分按谱面时间重算，支持向前/向后拖进度、重播和切谱，也适用于视频导出中途起始的片段。
尚未实现手动输入判定、挑战模式计分和特殊曲目分数冻结/Combo 文本覆盖。

进度条按原版 `nowTime / audioLength` 计算（音乐秒减谱面 offset），
点击左上角暂停图标切换播放/暂停；HUD 绘于后期特效之后，也会包含在视频导出帧中。
