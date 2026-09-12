from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

source_path = r"c:\Users\ds pcc\dangoimport-server\SECURITY_CORRECTIONS.md"
out_path = r"c:\Users\ds pcc\dangoimport-server\SECURITY_CORRECTIONS.pdf"

with open(source_path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()

styles = getSampleStyleSheet()
story = []

for line in lines:
    if line.startswith("# "):
        story.append(Paragraph(line[2:], styles["Title"]))
        story.append(Spacer(1, 12))
    elif line.startswith("## "):
        story.append(Paragraph(line[3:], styles["Heading2"]))
        story.append(Spacer(1, 8))
    elif line.startswith("---"):
        story.append(Spacer(1, 12))
    elif line.strip():
        story.append(Paragraph(line, styles["BodyText"]))
        story.append(Spacer(1, 5))
    else:
        story.append(Spacer(1, 6))

pdf = SimpleDocTemplate(out_path, pagesize=A4)
pdf.build(story)
print(f"PDF created: {out_path}")
