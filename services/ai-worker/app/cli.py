"""Command-Line Interface for Reel Studio AI Worker (Phase 2 Transcription Pipeline)."""

import argparse
import logging
import sys
import time
from pathlib import Path

from app.config import settings
from app.services.media_probe import MediaProbeService, NoAudioStreamError, MediaCorruptError
from app.services.audio_extractor import AudioExtractorService, AudioExtractionError
from app.services.transcriber import TranscriberService
from app.services.term_normalizer import TermNormalizerService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("reel_studio_cli")


def run_transcription_pipeline(
    input_path: str | Path,
    model_size: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    language: str | None = None,
    output_path: str | Path | None = None,
    limit_sec: float | None = None,
    force: bool = False
) -> int:
    """Runs the end-to-end Phase 2 audio extraction, transcription, and normalization pipeline.
    
    Returns:
        0 on success, non-zero on failure.
    """
    start_time = time.time()
    source_path = Path(input_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 2 TRANSCRIPTION PIPELINE")
    print("=" * 70)
    print(f"Source Media:       {source_path}")
    print(f"Model Selection:    {model_size}")
    print(f"Device / Compute:   {device} / {compute_type}")
    print(f"Language:           {language or 'Auto-Detect'}")
    print(f"Processing Limit:   {f'{limit_sec} seconds' if limit_sec else 'Full Recording'}")
    print("=" * 70 + "\n")

    # Step 1: Media Probing and Validation
    logger.info("Stage 1/3: Validating media headers with ffprobe...")
    try:
        media_meta = MediaProbeService.validate_for_transcription(source_path)
        print(f"  -> Duration:     {media_meta.duration_sec:.2f} seconds")
        print(f"  -> Video Stream: {'Yes (' + str(media_meta.width) + 'x' + str(media_meta.height) + ' @ ' + str(media_meta.fps) + ' fps)' if media_meta.has_video else 'Audio-only'}")
        print(f"  -> Audio Stream: Yes ({media_meta.audio_sample_rate} Hz, {media_meta.audio_channels} ch, {media_meta.audio_codec})")
    except FileNotFoundError as e:
        logger.error("Input file does not exist: %s", e)
        print(f"\n[ERROR] Input file not found: {source_path}", file=sys.stderr)
        return 1
    except NoAudioStreamError as e:
        logger.error("Audio validation failed: %s", e)
        print(f"\n[ERROR] {e}", file=sys.stderr)
        return 2
    except MediaCorruptError as e:
        logger.error("Media corrupt or unreadable: %s", e)
        print(f"\n[ERROR] {e}", file=sys.stderr)
        return 3
    except Exception as e:
        logger.exception("Unexpected error probing media: %s", e)
        return 4

    # Step 2: Audio Extraction to 16kHz mono WAV
    logger.info("Stage 2/3: Extracting 16kHz mono WAV via FFmpeg...")
    try:
        wav_path = AudioExtractorService.extract_audio(
            video_path=source_path,
            force_reextract=force
        )
        print(f"  -> Extracted WAV: {wav_path} ({wav_path.stat().st_size} bytes)")
    except AudioExtractionError as e:
        logger.error("Audio extraction failed: %s", e)
        print(f"\n[ERROR] Audio extraction failed: {e}", file=sys.stderr)
        return 5
    except Exception as e:
        logger.exception("Unexpected error during audio extraction: %s", e)
        return 6

    # Step 3: Speech Recognition & Word Alignment & Terminology Normalization
    logger.info("Stage 3/3: Running speech recognition (faster-whisper) & terminology normalizer...")
    try:
        normalizer = TermNormalizerService()
        transcriber = TranscriberService(
            model_size=model_size,
            device=device,
            compute_type=compute_type,
            language=language,
            term_normalizer=normalizer
        )

        validated_transcript = transcriber.transcribe(
            audio_path=wav_path,
            source_media_path=source_path,
            force_retranscribe=force,
            limit_sec=limit_sec
        )

        # Count normalized technical terms
        tech_terms_found = [
            d for d in validated_transcript.display_words
            if d.correction is not None and d.correction.applied
        ]

        elapsed = time.time() - start_time
        target_json = settings.TRANSCRIPTS_DIR / f"{wav_path.stem}.json"
        if output_path:
            out_p = Path(output_path).resolve()
            if out_p.is_dir():
                target_json = out_p / f"{wav_path.stem}.json"
            else:
                target_json = out_p
            # Write explicitly to user-specified output path
            with open(target_json, "w", encoding="utf-8") as f:
                f.write(validated_transcript.model_dump_json(indent=2))

        print("\n" + "=" * 70)
        print("TRANSCRIPTION PIPELINE COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Detected Language:        {validated_transcript.transcription.detected_language}")
        print(f"Processed Audio Duration: {validated_transcript.source.duration_sec:.2f}s")
        print(f"Raw Words Recognized:    {len(validated_transcript.raw_words)}")
        print(f"Display Tokens Produced:  {len(validated_transcript.display_words)}")
        print(f"Technical Terms Corrected:{len(tech_terms_found)}")
        for t in tech_terms_found[:10]:
            print(f"   * [{t.start_sec:.2f}s - {t.end_sec:.2f}s] '{t.correction.matched_alias}' -> '{t.text}' ({t.correction.term_id})")
        if len(tech_terms_found) > 10:
            print(f"   * ... and {len(tech_terms_found) - 10} more.")
        print(f"Wall-Clock Elapsed Time:  {elapsed:.2f}s")
        print(f"Validated Transcript JSON:{target_json}")
        print("=" * 70 + "\n")

        return 0

    except Exception as e:
        logger.exception("Transcription pipeline failed: %s", e)
        print(f"\n[ERROR] Transcription failed: {e}", file=sys.stderr)
        return 7


def main():
    parser = argparse.ArgumentParser(
        description="Reel Studio AI Worker — Phase 2 Audio Extraction & Word-Level Transcription CLI",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", required=True, help="Sub-commands")

    # 'transcribe' command
    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe audio/video to validated transcript JSON")
    transcribe_parser.add_argument(
        "-i", "--input",
        required=True,
        type=str,
        help="Path to the input video (e.g. storage/test_samples/lecture.mp4) or WAV file"
    )
    transcribe_parser.add_argument(
        "-m", "--model",
        type=str,
        default="small",
        help="Whisper model size (tiny, base, small, medium, large-v3)"
    )
    transcribe_parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Device to run inference on (cpu, cuda)"
    )
    transcribe_parser.add_argument(
        "--compute-type",
        type=str,
        default="int8",
        help="Quantization type (int8, float32, float16)"
    )
    transcribe_parser.add_argument(
        "-l", "--language",
        type=str,
        default=None,
        help="Language code (e.g. 'en'). Defaults to auto-detect."
    )
    transcribe_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file or directory path for transcript JSON"
    )
    transcribe_parser.add_argument(
        "--limit-sec",
        type=float,
        default=None,
        help="Optional duration limit in seconds for fast smoke testing"
    )
    transcribe_parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-extraction and re-transcription, bypassing cache"
    )

def run_highlight_selection(
    transcript_path: str | Path,
    min_duration_sec: float = 30.0,
    max_duration_sec: float = 60.0,
    output_path: str | Path | None = None
) -> int:
    """Runs intelligent highlight selection on a validated transcript JSON file.
    
    Returns:
        0 on success, non-zero on failure.
    """
    from app.services.highlight_selector import HighlightSelectorService

    start_time = time.time()
    path = Path(transcript_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 3 HIGHLIGHT SELECTION")
    print("=" * 70)
    print(f"Input Transcript:   {path}")
    print(f"Target Duration:    {min_duration_sec:.1f}s - {max_duration_sec:.1f}s")
    print("=" * 70 + "\n")

    if not path.exists():
        logger.error("Transcript file does not exist: %s", path)
        print(f"\n[ERROR] Transcript file not found: {path}", file=sys.stderr)
        return 1

    try:
        logger.info("Loading transcript and analyzing candidate highlight windows...")
        result = HighlightSelectorService.select_from_file(
            transcript_path=path,
            min_duration_sec=min_duration_sec,
            max_duration_sec=max_duration_sec
        )

        saved_path = HighlightSelectorService.save_highlight(result, output_path=output_path)
        elapsed = time.time() - start_time
        sb = result.score_breakdown

        print("\n" + "=" * 70)
        print("HIGHLIGHT SELECTION COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Selected Window:     [{result.start_sec:.2f}s - {result.end_sec:.2f}s] ({result.duration_sec:.2f}s)")
        print(f"Selection Score:     {result.score:.2f} / 100.0")
        print(f"Selection Method:    {result.selection_method}")
        print(f"Primary Reasoning:   {result.reason}")
        print(f"Word Token Range:    #{result.word_start_id} to #{result.word_end_id}")
        print(f"Score Breakdown:")
        print(f"  * Information Value: {sb.information_value:.2f} / 100")
        print(f"  * Self-Contained:    {sb.self_contained:.2f} / 100")
        print(f"  * Opening Hook:      {sb.opening_hook:.2f} / 100")
        print(f"  * Ending Quality:    {sb.ending_quality:.2f} / 100")
        print(f"  * Speech Density:    {sb.speech_density:.2f} / 100")
        print(f"  * ASR Confidence:    {sb.confidence:.2f} / 100")
        if sb.duration_penalty > 0:
            print(f"  * Duration Penalty:  -{sb.duration_penalty:.2f} pts")
        print(f"\nTranscript Excerpt:")
        print(f'"{result.transcript_excerpt}"')
        print(f"\nWall-Clock Time:     {elapsed:.3f}s")
        print(f"Output Highlight:    {saved_path}")
        print("=" * 70 + "\n")
        return 0

    except Exception as e:
        logger.exception("Highlight selection failed: %s", e)
        print(f"\n[ERROR] Highlight selection failed: {e}", file=sys.stderr)
        return 2


def main():
    parser = argparse.ArgumentParser(
        description="Reel Studio AI Worker CLI — Transcription & Highlight Selection",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", required=True, help="Sub-commands")

    # 'transcribe' command
    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe audio/video to validated transcript JSON")
    transcribe_parser.add_argument(
        "-i", "--input",
        required=True,
        type=str,
        help="Path to the input video (e.g. storage/test_samples/lecture.mp4) or WAV file"
    )
    transcribe_parser.add_argument(
        "-m", "--model",
        type=str,
        default="small",
        help="Whisper model size (tiny, base, small, medium, large-v3)"
    )
    transcribe_parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Device to run inference on (cpu, cuda)"
    )
    transcribe_parser.add_argument(
        "--compute-type",
        type=str,
        default="int8",
        help="Quantization type (int8, float32, float16)"
    )
    transcribe_parser.add_argument(
        "-l", "--language",
        type=str,
        default=None,
        help="Language code (e.g. 'en'). Defaults to auto-detect."
    )
    transcribe_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file or directory path for transcript JSON"
    )
    transcribe_parser.add_argument(
        "--limit-sec",
        type=float,
        default=None,
        help="Optional duration limit in seconds for fast smoke testing"
    )
    transcribe_parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-extraction and re-transcription, bypassing cache"
    )

    # 'select-highlight' command
    highlight_parser = subparsers.add_parser("select-highlight", help="Select best educational highlight from transcript JSON")
    highlight_parser.add_argument(
        "-i", "--input-transcript",
        required=True,
        type=str,
        help="Path to validated transcript JSON (e.g. storage/transcripts/lecture.json)"
    )
    highlight_parser.add_argument(
        "--min-duration-sec",
        type=float,
        default=30.0,
        help="Minimum clip duration in seconds"
    )
    highlight_parser.add_argument(
        "--max-duration-sec",
        type=float,
        default=60.0,
        help="Maximum clip duration in seconds"
    )
    highlight_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file path for highlight result JSON"
    )

    args = parser.parse_args()

    if args.command == "transcribe":
        code = run_transcription_pipeline(
            input_path=args.input,
            model_size=args.model,
            device=args.device,
            compute_type=args.compute_type,
            language=args.language,
            output_path=args.output,
            limit_sec=args.limit_sec,
            force=args.force
        )
        sys.exit(code)
    elif args.command == "select-highlight":
        code = run_highlight_selection(
            transcript_path=args.input_transcript,
            min_duration_sec=args.min_duration_sec,
            max_duration_sec=args.max_duration_sec,
            output_path=args.output
        )
        sys.exit(code)


if __name__ == "__main__":
    main()
