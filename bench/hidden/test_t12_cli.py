import json, os, subprocess, sys, tempfile, unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def run(args):
    r = subprocess.run([sys.executable, os.path.join(ROOT, "py", "transcribe_clips.py"), *args],
                       capture_output=True, text=True, cwd=ROOT, timeout=60)
    return r.returncode, [json.loads(l) for l in r.stdout.splitlines() if l.strip()], r.stderr


class T12(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.segs = os.path.join(self.dir, "segs.json")
        with open(self.segs, "w") as f:
            json.dump([{"start": 0.0, "end": 40.0, "speaker": 0}], f)

    def test_with_cuts(self):
        code, lines, err = run([self.segs, "--total", "50", "--cuts", "5,10,16,30,33"])
        self.assertEqual(code, 0, err)
        self.assertEqual([(l["start"], l["end"], l["speaker"]) for l in lines], [(0.0, 16.0, 0), (16.0, 33.0, 0), (33.0, 40.15, 0)])

    def test_without_cuts_rounds_to_two_decimals(self):
        code, lines, err = run([self.segs, "--total", "50"])
        self.assertEqual(code, 0, err)
        self.assertEqual([(l["start"], l["end"]) for l in lines], [(0.0, 16.0), (16.0, 32.0), (32.0, 40.15)])

    def test_import_still_works(self):
        sys.path.insert(0, os.path.join(ROOT, "py"))
        import transcribe_clips
        self.assertTrue(callable(transcribe_clips.clips))


if __name__ == "__main__":
    unittest.main()
