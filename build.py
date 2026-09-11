from pathlib import Path
ROOT=Path(__file__).resolve().parent
SRC=ROOT/"src"
DIST=ROOT/"dist"
DIST.mkdir(exist_ok=True)
t=(SRC/"index.html").read_text(encoding="utf-8")
css=(SRC/"css/style.css").read_text(encoding="utf-8")
order=['config.js', 'data.js', 'formulas.js', 'teacher_demo.js', 'quests.js', 'state.js', 'story.js', 'story_plus.js', 'course.js', 'realms.js', 'problems.js', 'story_g8.js', 'story_g9.js', 'problems_g8.js', 'problems_g9.js', 'content_g7_plus.js', 'art.js', 'forces.js', 'trainer.js', 'app.js']
js="\n\n".join((SRC/"js"/n).read_text(encoding="utf-8").rstrip() for n in order)
out=t.replace("<!-- BUILD:CSS -->","<style>\n"+css+"\n</style>").replace("<!-- BUILD:JS -->","<script>\n"+js+"\n</script>")
(DIST/"Fizika.html").write_text(out,encoding="utf-8")
print("Built",DIST/"Fizika.html")
