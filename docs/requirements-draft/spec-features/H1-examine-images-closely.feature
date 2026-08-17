# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story H1) and the SPARCd requirements wiki User Stories page.

@H1
Feature: Examine images closely to catch every species

  """
  As a species identifier, I want to zoom into and out of an image, so that I
  can spot species that are small, distant, or partly hidden.
  """

  Harold reviews large numbers of images on a small, low-powered laptop.
  Animals are often small, distant or half-hidden, so close examination is
  the core of his work — and it has to stay smooth over hundreds of images.

  Background:
    Given Harold is viewing an image in a collection he has access to

  @H1
  Scenario: Detail becomes legible well beyond the fit-to-screen size
    When Harold zooms into the image
    Then detail that was not legible at fit-to-screen size becomes clearly legible
    And he can continue enlarging well past the fit-to-screen size

  @H1
  Scenario: Harold can move around an enlarged image
    Given Harold has zoomed in so that only part of the image is shown
    When he moves around the enlarged image
    Then he can reach any part of the image, including its edges and corners

  @H1
  Scenario: Harold can return to seeing the whole image
    Given Harold has zoomed into the image
    When he zooms back out
    Then he can see the whole image again

  @H1
  Scenario: Zooming and panning stay responsive on a small, low-powered laptop
    Given Harold is working on a small, low-powered laptop
    When he zooms and moves around images repeatedly
    Then the view keeps up with his input without stalling
    And responsiveness does not degrade as he works through many images in a session

  @H1
  Scenario: Moving to another image does not carry over a confusing zoom state
    Given Harold has zoomed into a region of one image
    When he moves to another image
    Then the new image is not left in a zoom state carried over from the previous one
    And he can see what he is looking at without first having to correct the view

  @H1
  Scenario: Close examination works on images of differing sizes and shapes
    Given the collection contains images of differing sizes and proportions
    When Harold examines each of them closely
    Then zooming and moving around behave the same way for each
