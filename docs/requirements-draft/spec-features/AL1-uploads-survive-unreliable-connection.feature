# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story AL1) and the SPARCd requirements wiki User Stories page.

@AL1
Feature: Uploads survive an unreliable connection

  """
  As a species identifier on unreliable internet, I want an interrupted upload
  to continue on its own when the connection returns, so that overnight
  uploads finish without my attention.
  """

  Alice's connection drops repeatedly overnight. She should be able to start
  an upload, go to bed, and find in the morning either a finished upload or
  one that plainly says how to carry on — never one that stopped without
  saying so.

  Background:
    Given Alice has started an upload of a batch of images

  @AL1
  Scenario: An interrupted upload continues on its own when the connection returns
    Given the connection drops while the upload is in progress
    When connectivity returns
    Then the upload continues
    And Alice does not have to restart it manually

  @AL1
  Scenario: Data already transferred and verified is not sent again
    Given part of the batch has already transferred and been verified
    And the upload was interrupted
    When the upload continues
    Then the already-verified data is not sent a second time
    And only the remaining data is transferred

  @AL1
  Scenario: An unattended upload is found either complete or clearly resumable
    Given Alice leaves the upload running unattended overnight
    When she returns in the morning
    Then the upload is either shown as complete, or shown as interrupted together with what is needed to carry on

  @AL1
  Scenario: An upload is never left in a silent, stuck state
    Given the upload has stopped making progress
    When Alice looks at it
    Then she is told that it has stopped and why, as far as is known
    And it is not presented as still progressing

  @AL1
  Scenario: Repeated interruptions still end in one finished upload
    Given the connection drops and returns several times during the upload
    When the upload finally completes
    Then the collection contains the batch exactly once
    And no image was left behind by the interruptions

  @AL1
  Scenario: An interrupted upload is not presented as complete
    Given the upload was interrupted before all data transferred
    When Alice or anyone else looks at the upload
    Then it is not shown as a completed upload
