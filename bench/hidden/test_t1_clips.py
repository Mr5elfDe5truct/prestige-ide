import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py"))
from transcribe_clips import clips


def r(out):
    return [(round(a, 2), round(b, 2), s) for a, b, s in out]


class T1(unittest.TestCase):
    def test_cuts_at_last_pause_before_limit(self):
        self.assertEqual(r(clips([{"start": 0.0, "end": 40.0, "speaker": 0}], [5, 10, 16, 30, 33], 50.0)),
                         [(0.0, 16, 0), (16, 33, 0), (33, 40.15, 0)])

    def test_hard_cuts_without_pauses(self):
        self.assertEqual(r(clips([{"start": 2.0, "end": 60.0, "speaker": 1}], [], 70.0)),
                         [(1.85, 17.85, 1), (17.85, 33.85, 1), (33.85, 49.85, 1), (49.85, 60.15, 1)])

    def test_two_speakers(self):
        segs = [{"start": 0.0, "end": 10.0, "speaker": 0}, {"start": 10.5, "end": 45.0, "speaker": 2}]
        self.assertEqual(r(clips(segs, [12, 20, 27, 31, 40], 45.0)), [(0.0, 10.15, 0), (10.35, 27, 2), (27, 45.0, 2)])


if __name__ == "__main__":
    unittest.main()
