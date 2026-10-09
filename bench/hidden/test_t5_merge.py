import copy, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py"))
from transcribe_clips import merge_segments


def seg(a, b, s):
    return {"start": a, "end": b, "speaker": s}


class T5(unittest.TestCase):
    def test_merges_short_gaps_same_speaker(self):
        segs = [seg(0, 2, 0), seg(2.3, 4, 0), seg(5, 6, 0), seg(6.2, 7, 1)]
        self.assertEqual(merge_segments(segs, 0.5), [seg(0, 4, 0), seg(5, 6, 0), seg(6.2, 7, 1)])

    def test_default_gap_is_half_a_second(self):
        self.assertEqual(merge_segments([seg(0, 1, 3), seg(1.4, 2, 3)]), [seg(0, 2, 3)])
        self.assertEqual(merge_segments([seg(0, 1, 3), seg(1.6, 2, 3)]), [seg(0, 1, 3), seg(1.6, 2, 3)])

    def test_bigger_gap_merges_chains(self):
        segs = [seg(0, 2, 0), seg(2.3, 4, 0), seg(5, 6, 0), seg(6.2, 7, 1)]
        self.assertEqual(merge_segments(segs, 2), [seg(0, 6, 0), seg(6.2, 7, 1)])

    def test_different_speakers_never_merge(self):
        segs = [seg(0, 1, 0), seg(1.1, 2, 1), seg(2.1, 3, 0)]
        self.assertEqual(merge_segments(segs, 5), segs)

    def test_empty_and_no_mutation(self):
        self.assertEqual(merge_segments([], 0.5), [])
        segs = [seg(0, 2, 0), seg(2.1, 4, 0)]
        before = copy.deepcopy(segs)
        merge_segments(segs, 0.5)
        self.assertEqual(segs, before)


if __name__ == "__main__":
    unittest.main()
