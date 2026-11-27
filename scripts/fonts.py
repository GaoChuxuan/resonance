import shutil, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = r'C:\Users\omen\Desktop\Documents\Printing\Resonance'
UF = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Windows\Fonts')
OUT = os.path.join(ROOT, 'fonts')
os.makedirs(OUT, exist_ok=True)

for n in ['SourceHanSansSC-Light', 'SourceHanSansSC-Regular', 'SourceHanSansSC-Medium', 'SourceHanSansSC-Bold', 'SourceHanSansSC-Heavy',
          'NotoSerifCJKsc-Light', 'NotoSerifCJKsc-Regular', 'NotoSerifCJKsc-Medium', 'NotoSerifCJKsc-SemiBold', 'NotoSerifCJKsc-Bold', 'NotoSerifCJKsc-Black']:
    src = os.path.join(UF, n + '.otf')
    if not os.path.exists(src):
        src = os.path.join(r'C:\Windows\Fonts', n + '.otf')
    shutil.copy2(src, os.path.join(OUT, n + '.otf'))
    print('copied', n)

vf_path = os.path.join(UF, 'GoogleSansFlex-VariableFont_GRAD,ROND,opsz,slnt,wdth,wght.ttf')
vf = TTFont(vf_path)
axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in vf['fvar'].axes}
print('axes', axes)

def clamp(tag, v):
    lo, d, hi = axes[tag]
    return max(lo, min(hi, v))

# name, wght, wdth, opsz
targets = [
    ('GSF-Text-Regular', 400, 100, 12),
    ('GSF-Text-Medium', 500, 100, 12),
    ('GSF-Text-Bold', 700, 100, 12),
    ('GSF-Display-Light', 300, 100, 72),
    ('GSF-Display-Medium', 500, 100, 72),
    ('GSF-Display-Bold', 700, 100, 72),
    ('GSF-Cond-Medium', 500, 25, 72),
    ('GSF-Cond-Bold', 700, 25, 72),
    ('GSF-Cond-Black', 900, 25, 72),
    # 章扉页「GS W」：只动字重轴，wdth / opsz / ROND / slnt（及 GRAD）全部钉在字体默认值
    ('GSF-W-Regular', 400, None, None),
    ('GSF-W-Medium', 500, None, None),
    ('GSF-W-Bold', 700, None, None),
    ('GSF-W-Black', 900, None, None),
]
for name, w, wd, op in targets:
    loc = {}
    for tag in axes:
        if tag == 'wght': loc[tag] = clamp(tag, w)
        elif tag == 'wdth' and wd is not None: loc[tag] = clamp(tag, wd)
        elif tag == 'opsz' and op is not None: loc[tag] = clamp(tag, op)
        else: loc[tag] = axes[tag][1]
    f = instancer.instantiateVariableFont(TTFont(vf_path), loc, updateFontNames=False)
    f.save(os.path.join(OUT, name + '.ttf'))
    print('instanced', name, loc)
print('DONE')
