package com.tally.expense;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

/** The recognizer sequences VoiceSession has to survive, as Android delivers them. */
public class VoiceSessionTest {

  /** Writes every action down as one short line, in order. */
  private static final class Log implements VoiceSession.Actions {
    final List<String> lines = new ArrayList<>();

    @Override public void state(String state) { lines.add("state " + state); }
    @Override public void level(float level) { lines.add("level " + level); }
    @Override public void partial(String text) { lines.add("partial " + text); }
    @Override public void result(List<String> matches, float[] confidences) {
      lines.add("result " + matches + " " + Arrays.toString(confidences));
    }
    @Override public void failed(String reason, int code) { lines.add("failed " + reason + " " + code); }
    @Override public void restart(long delayMs, boolean defaultLanguage) {
      lines.add("restart " + delayMs + (defaultLanguage ? " default-language" : ""));
    }
    @Override public void stopRecognizer() { lines.add("stop"); }
    @Override public void cancelRecognizer() { lines.add("cancel"); }
    @Override public void schedule(int timer, long delayMs) { lines.add("schedule " + timer); }
    @Override public void unschedule(int timer) {}
    @Override public void finished() { lines.add("finished"); }

    /** The lines that say how the session ended: a result or a failure, then finished. */
    List<String> ending() {
      List<String> end = new ArrayList<>();
      for (String l : lines) {
        if (l.startsWith("result") || l.startsWith("failed") || l.equals("finished")) end.add(l);
      }
      return end;
    }

    boolean has(String line) { return lines.contains(line); }
  }

  private Log log;
  private VoiceSession session;

  @Before
  public void setUp() {
    log = new Log();
    session = new VoiceSession(log);
    session.begin();
  }

  private static List<String> said(String... texts) { return Arrays.asList(texts); }

  @Test
  public void finalTranscriptWinsOverTheLastCaption() {
    session.onReady();
    session.onBeginningOfSpeech();
    session.onPartial(said("250 shop"));
    session.onEndOfSpeech();
    session.onResults(said("250 shopping", "250 shopping bag"), new float[] { 0.92f, 0.4f });
    assertEquals(Arrays.asList("result [250 shopping, 250 shopping bag] [0.92, 0.4]", "finished"), log.ending());
  }

  @Test
  public void lettingGoStopsTheRecognizerAndWaitsForTheFinalAnswer() {
    session.onReady();
    session.onPartial(said("90 chai"));
    session.stop();
    assertTrue(log.has("stop"));
    assertTrue(log.has("state processing"));
    session.onResults(said("90 chai from cash"), null);
    assertEquals(Arrays.asList("result [90 chai from cash] [-1.0]", "finished"), log.ending());
  }

  @Test
  public void noMatchAfterACaptionKeepsTheCaption() {
    session.onReady();
    session.onPartial(said("got 2000 from Rahul"));
    session.stop();
    session.onError(VoiceSession.ERROR_NO_MATCH);
    assertEquals(Arrays.asList("result [got 2000 from Rahul] [-1.0]", "finished"), log.ending());
  }

  @Test
  public void silenceEndsAsNothingRightAway() {
    session.onReady();
    session.onError(VoiceSession.ERROR_SPEECH_TIMEOUT);
    assertEquals(Arrays.asList("failed nothing 6", "finished"), log.ending());
  }

  @Test
  public void aBusyRecognizerGetsOneFreshStart() {
    session.onError(VoiceSession.ERROR_RECOGNIZER_BUSY);
    assertTrue(log.has("restart " + VoiceSession.RETRY_DELAY_MS));
    assertTrue(log.ending().isEmpty());
    session.onReady();
    session.onPartial(said("uber 340"));
    session.onResults(said("uber 340"), new float[] { 0.8f });
    assertEquals(Arrays.asList("result [uber 340] [0.8]", "finished"), log.ending());
  }

  @Test
  public void stillBusyAfterTheFreshStartSaysSo() {
    session.onError(VoiceSession.ERROR_RECOGNIZER_BUSY);
    session.onError(VoiceSession.ERROR_RECOGNIZER_BUSY);
    assertEquals(Arrays.asList("failed busy 8", "finished"), log.ending());
  }

  @Test
  public void aServiceThatNeverAnswersIsRestartedThenGivenUpOn() {
    session.onTimer(VoiceSession.TIMER_READY);
    assertTrue(log.has("restart " + VoiceSession.RETRY_DELAY_MS));
    session.onTimer(VoiceSession.TIMER_READY);
    assertTrue(log.has("cancel"));
    assertEquals(Arrays.asList("failed error 0", "finished"), log.ending());
  }

  @Test
  public void aFinalAnswerThatNeverComesFallsBackToTheCaption() {
    session.onReady();
    session.onPartial(said("dhai sau ka khana"));
    session.stop();
    session.onTimer(VoiceSession.TIMER_RESULT);
    assertEquals(Arrays.asList("result [dhai sau ka khana] [-1.0]", "finished"), log.ending());
  }

  @Test
  public void aClientErrorAfterLettingGoWithNothingHeardIsNothing() {
    session.onReady();
    session.stop();
    session.onError(VoiceSession.ERROR_CLIENT);
    assertEquals(Arrays.asList("failed nothing 5", "finished"), log.ending());
  }

  @Test
  public void cancelSendsNothingAfterwards() {
    session.onReady();
    session.onPartial(said("250"));
    session.cancel();
    session.onResults(said("250 lunch"), null);
    session.onError(VoiceSession.ERROR_CLIENT);
    assertEquals(Collections.singletonList("finished"), log.ending());
    assertTrue(log.has("cancel"));
  }

  @Test
  public void endsExactlyOnce() {
    session.onReady();
    session.onPartial(said("500 rent"));
    session.onResults(said("500 rent"), null);
    session.onError(VoiceSession.ERROR_NO_MATCH);
    session.onTimer(VoiceSession.TIMER_RESULT);
    session.onResults(said("500 rent again"), null);
    assertEquals(Arrays.asList("result [500 rent] [-1.0]", "finished"), log.ending());
  }

  @Test
  public void anUnsupportedLanguageRetriesInThePhonesOwn() {
    session.onError(VoiceSession.ERROR_LANGUAGE_UNAVAILABLE);
    assertTrue(log.has("restart " + VoiceSession.RETRY_DELAY_MS + " default-language"));
    session.onError(VoiceSession.ERROR_LANGUAGE_UNAVAILABLE);
    assertEquals(Arrays.asList("failed unavailable 13", "finished"), log.ending());
  }

  @Test
  public void noNetworkWithNothingHeardSaysNetwork() {
    session.onReady();
    session.onError(VoiceSession.ERROR_NETWORK);
    assertEquals(Arrays.asList("failed network 2", "finished"), log.ending());
  }

  @Test
  public void missingPermissionSaysDenied() {
    session.onError(VoiceSession.ERROR_INSUFFICIENT_PERMISSIONS);
    assertEquals(Arrays.asList("failed denied 9", "finished"), log.ending());
  }

  @Test
  public void aCaptionWithoutReadyStillCountsAsSpeech() {
    session.onPartial(said("chai 20"));
    assertTrue(log.has("state speech"));
    session.onTimer(VoiceSession.TIMER_READY);
    assertTrue(log.ending().isEmpty());
  }

  @Test
  public void repeatedCaptionsAreSentOnce() {
    session.onReady();
    session.onPartial(said("250"));
    session.onPartial(said("250"));
    session.onPartial(said("250 lunch"));
    long partials = log.lines.stream().filter((l) -> l.startsWith("partial")).count();
    assertEquals(2, partials);
  }

  @Test
  public void levelsAreThrottledAndClamped() {
    session.onReady();
    session.onRms(-10f, 0);
    session.onRms(10f, 10);
    session.onRms(20f, 60);
    assertEquals(Arrays.asList("level 0.0", "level 1.0"),
        log.lines.stream().filter((l) -> l.startsWith("level")).collect(java.util.stream.Collectors.toList()));
  }

  @Test
  public void emptyAndDuplicateAlternatesAreDropped() {
    session.onReady();
    session.onResults(said(" ", "250 lunch", "250 lunch", "250 launch"), new float[] { 0f, 0.9f, 0.9f, 0.3f });
    assertEquals(Arrays.asList("result [250 lunch, 250 launch] [0.9, 0.3]", "finished"), log.ending());
  }

  @Test
  public void theTimeLimitLetsGoForThePerson() {
    session.onReady();
    session.onPartial(said("so I bought"));
    session.onTimer(VoiceSession.TIMER_LIMIT);
    assertTrue(log.has("stop"));
  }
}
