import unittest

from transcribe_clips import clips, parse_silence


class ClipsTest(unittest.TestCase):
    def test_short_stretch_is_one_clip(self):
        self.assertEqual(clips([{"start": 1.0, "end": 5.0, "speaker": 0}], [], 10.0), [(0.85, 5.15, 0)])

    def test_parse_silence(self):
        err = "silence_start: 2.0\nsilence_end: 3.0\nsilence_start: 10\nsilence_end: 11"
        self.assertEqual(parse_silence(err), [2.5, 10.5])


if __name__ == "__main__":
    unittest.main()
