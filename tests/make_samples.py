"""Generate sample DXFs for manual/automated checks. Run: python make_samples.py"""
import os

def dxf(ents, insunits=None):
    o = ["0", "SECTION", "2", "HEADER"]
    if insunits is not None:
        o += ["9", "$INSUNITS", "70", str(insunits)]
    o += ["0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"] + ents + ["0", "ENDSEC", "0", "EOF"]
    return "\n".join(o) + "\n"

def line(x0, y0, x1, y1):
    return ["0", "LINE", "8", "0", "10", str(x0), "20", str(y0), "11", str(x1), "21", str(y1)]

def circle(x, y, r):
    return ["0", "CIRCLE", "8", "0", "10", str(x), "20", str(y), "40", str(r)]

def lwpoly(pts, closed=True):
    e = ["0", "LWPOLYLINE", "8", "0", "90", str(len(pts)), "70", "1" if closed else "0"]
    for p in pts:
        e += ["10", str(p[0]), "20", str(p[1])] + (["42", str(p[2])] if len(p) > 2 else [])
    return e

here = os.path.dirname(os.path.abspath(__file__))
def w(name, text):
    open(os.path.join(here, name), "w", newline="").write(text)

# 1. clean 100x60 plate, polyline + 2 holes (expected: cut 320 + 2*pi*5*... see expected.txt)
w("clean_plate.dxf", dxf(lwpoly([(0, 0), (100, 0), (100, 60), (0, 60)]) + circle(20, 30, 5) + circle(80, 30, 5), 4))
# 2. defective: lines with a 0.05 gap, a duplicate line, and a doubled hole; declared inches but really mm
ents = line(0, 0, 100, 0) + line(100, 0, 100, 60) + line(100, 60, 0, 60) + line(0, 60, 0, 0.05) \
     + line(0, 0, 100, 0) + circle(50, 30, 10) + circle(50, 30, 10)
w("defective_plate.dxf", dxf(ents, 1))
# 3. rounded rectangle via bulge (4 arcs of r=10): 100x60, perimeter = 2*(80+40)+2*pi*10
b = 0.41421356237
w("rounded_bulge.dxf", dxf(lwpoly([(10, 0), (90, 0, b), (100, 10), (100, 50, b), (90, 60), (10, 60, b), (0, 50), (0, 10, b)]), 4))
print("ok")
