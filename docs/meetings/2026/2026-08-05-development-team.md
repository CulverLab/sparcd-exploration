# SPARCd Development Team Meeting Notes

*Governance, roles, and the requirements-to-implementation workflow*

> **Verification note:** These notes were reconstructed from my (Susan Malusa) written notes and photographs of the meeting whiteboards after the Zoom transcript failed. Attendees should verify them for accuracy. - SMM

**Date:** August 5, 2026

**Format:** Hybrid; Julian Gonzalez participated remotely

**Development repository:** [CulverLab/sparcd-exploration](https://github.com/CulverLab/sparcd-exploration)

**Requirements and user stories:** [CulverLab/sparcd-requirements wiki](https://github.com/CulverLab/sparcd-requirements/wiki)

## Participants

- Susan Malusa

- Julian Pistorius

- Chris Schnaufer

- Julian Gonzalez (remote)

> **Invited, not present:** Liz Taylor, community scientist. Liz has contributed to the development of SPARCd user stories in the requirements wiki.

## Three goals entering the meeting

- **Architecture.** Agree on a minimal, modular SPARCd architecture that allows the team to develop in parallel streams.

- **Governance.** Define how the team will work together, make decisions, document changes, and assign project and repository roles.

- **Code quality.** Establish review, automated testing, and validation requirements, including tests that run before code is pushed or merged.

## Purpose

Determine how to move SPARCd development forward as a collaborative team, clarify how decisions and code changes will be governed, identify the governance roles the project needs, and establish a traceable path from the user stories in the requirements wiki to implementation in the development repository.

## Summary

SPARCd development has moved from a primarily single-developer effort to a shared team model. The team wants to move quickly while preserving clear requirements, collective responsibility, code quality, and a complete record of why each change was made. Exosphere and ZeroMQ will be used only as templates while the team develops SPARCd's own governance and development structure.[^1] The goal is to prepare SPARCd for representation through Open Source Collective as well.

> **Central agreement:** GitHub will serve as the authoritative record of SPARCd development. Requirements, issues, design decisions, documentation, commits, pull requests, reviews, tests, and merges must be linked so the full reason, implementation, and approval history of each change can be reconstructed. Every change must also be reviewed by at least one other team member before it is merged; no maintainer should be the only set of eyes on their own change.

## Decisions and working agreements

- **Shared maintenance.** All four current team members will serve as SPARCd maintainers and collectively form the initial Maintainer Council.

- **GitHub as the development record.** All development activity, including requirements, issues, design decisions, documentation changes, commits, pull requests, reviews, test results, and merges, must be recorded and linked in GitHub so the reason, implementation, and approval of each change remain traceable.

- **Peer review before merge.** A change requires review by at least one person other than its author before it is merged or pushed to the shared codebase.

- **Small, reviewable work slices.** Use minimal, focused changes so work can proceed quickly and in parallel without losing the relationship to the originating requirement.

- **Simple architecture.** Keep architecture as simple and modular as practical so development can occur in parallel streams.

- **Automated quality checks.** Automated tests and relevant validation should run before a change is merged.

- **Visible decision-making.** Use GitHub issues and discussions to record proposals, questions, objections, and decisions. Meetings or other channels may support discussion, but the resulting decision and its connection to the relevant development work must be captured in GitHub.

- **Weekly coordination.** Meet weekly during this active development phase to unblock work and maintain momentum.

## Requirements-to-implementation workflow

The team discussed organizing the requirements work in the following order, beginning with the personas and user stories documented in the sparcd-requirements wiki. The sequence keeps each technical change connected to a real user and a defined measure of success.

1.  **Persona and user story:** Every user story identifies a persona and describes the need from that user's perspective.

2.  **Use case:** Translate related user stories into a use case with a clear title, actors or persona, intended behavior, and success criteria.

3.  **SRS and BDD requirements:** Use an agreed Software Requirements Specification template to capture functional and nonfunctional requirements. Express important behavior as Behavior-Driven Development scenarios.

4.  **Issue and development slice:** Break the requirement into a small, focused GitHub issue that identifies the problem, the relevant use case or scenario, and the work to be completed.

5.  **Implementation:** Develop the smallest accurate change that satisfies the documented requirement. Commits and pull requests must reference the originating issue and preserve the link to the use case or BDD/SRS requirement.

6.  **Automated tests and validation:** Use executable BDD scenarios and other automated tests to verify the requirement, not merely to validate that code runs.

7.  **Peer review and merge:** A different maintainer reviews the change, confirms the issue and success criteria are addressed, and then approves the merge.

**In short:** *persona and user story -> use case -> SRS/BDD requirement -> issue and work slice -> implementation -> tests -> peer review and merge.*

### What the BDD/SRS work must accomplish

- Capture the actual requirement and expected behavior, not only test or validation steps.

- Make success criteria explicit and executable wherever possible.

- Include both functional requirements (what SPARCd must do) and nonfunctional requirements (for example, performance, reliability, security, usability, and maintainability).

- Provide a common basis for discussion across the product, scientific, and software perspectives.

- Allow the team to see whether later implementation still matches the original user need.

## Governance and team responsibilities

The meeting identified a governance role framework to be adapted from the Exosphere and ZeroMQ models. Roles describe project authority and responsibilities; they are not assignments for tracking an individual's daily work. SPARCd may define a needed role before selecting the person or group that will fill it. The confirmed decision was that all four current team members will be maintainers.

| **Governance role**         | **Purpose and authority**                                                                                                                                                                                                   | **Current SPARCd status**                                               |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| **Project Steward / Owner** | Provides global project oversight by keeping development aligned with SPARCd's scientific mission, users, priorities, sustainability, and adopted governance. This is not a day-to-day personnel or activity-tracking role. | **Susan Malusa; formal scope to be documented**                         |
| **Administrator**           | Manages repository access and the maintainer roster, supports succession, and ensures the governance and conduct processes can be carried out. The role may be held by one or more people.                                  | **Not yet formally assigned**                                           |
| **Maintainer Council**      | The collective body of all maintainers. It governs the project, manages shared resources, resolves material decisions, and appoints or removes governance roles under the adopted charter.                                  | **Filled by the four current maintainers**                              |
| **Maintainer**              | Reviews and merges contributions, applies the agreed process, confirms issue linkage and required checks, and does not normally merge their own work without another maintainer's review.                                   | **Susan Malusa; Julian Pistorius; Chris Schnaufer; Julian Gonzalez**    |
| **Contributor**             | Any person who proposes an issue or submits code, documentation, tests, or other work through the contribution process. Merge authority is granted only through the Maintainer role.                                        | **Open role; no fixed appointment required**                            |
| **Creator / Founder**       | Records project origin or authorship. It does not automatically carry repository, merge, or governance authority unless SPARCd explicitly assigns that authority in its charter.                                            | **Historical attribution to be documented; not an operational vacancy** |
| **Security Response Team**  | Receives and coordinates confidential security reports. This function may remain with the Maintainer Council or be delegated to at least two qualified contributors.                                                        | **Not yet designated**                                                  |

**Working principle:** *Project visibility will center on the linked GitHub record of requirements, issues, decisions, commits, pull requests, reviews, tests, and shared outcomes rather than individualized activity tracking. The Project Steward provides global oversight, while the Maintainer Council collectively governs technical work. Formal permissions, appointment and removal rules, succession, and conflict handling still need to be adopted.*

### Decision-making approach

- Discussion and explicit agreement are the normal decision method. Proposals should be documented in GitHub and reviewed by the maintainers or other participants affected by the decision.

- Lazy consensus may be used only as a secondary option for low-risk, reversible, non-breaking matters after the proposal is documented, the affected maintainers are notified, and a reasonable review period has passed. It is acceptable in these limited situations, but it is not the team's first-choice decision method.

- A concern should identify the specific risk or problem and, when possible, suggest an alternative.

- Material governance, licensing, security, architecture, or breaking changes require explicit discussion and the approval process defined in the governance document.

- Use GitHub Discussions or issues as the written record and define notifications so a lack of response reflects a real opportunity to review, not a missed message.

## Application structure and architecture

SPARCd development is organized around three primary applications and a fourth home or landing component. The architecture should keep these areas sufficiently modular to support parallel development while preserving shared standards and integration.

- **Uploader.** Imports camera-card images and associated metadata into SPARCd.
- **Tagger.** Supports image review, species identification, and tagging.
- **Explorer.** Supports querying, filtering, viewing, and exporting project data.
- **Home.** Provides the entry point and navigation among the SPARCd applications.

## Code quality and AI-assisted development

- Document shared agentic-coding guidance and prompt sets in a repository Markdown document (for example, AGENTS.md or the team's chosen equivalent).

- Apply the same issue linkage, requirement traceability, automated testing, and peer-review rules to AI-assisted code as to human-written code.

- Treat the linked GitHub history as the project system of record. Development decisions or changes discussed in meetings, chat, or other channels must be reflected in the relevant issue, pull request, commit, or repository documentation.

- Run automated tests before changes are merged, and expand the test suite as BDD scenarios are formalized.

- Keep architecture and code changes minimal enough to review accurately and to avoid blocking parallel development.

## Next steps

| **No.** | **Next step**                                                                                                                                                                                                                     | **Current status**          |
|---------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------|
| **1**   | Adapt and publish a SPARCd governance charter from the Exosphere and ZeroMQ templates, including roles, permissions, decisions, peer review, appointments, removal, and succession.                                               | Pending team decision       |
| **2**   | Formally define the Project Steward / Owner scope and select one or more Administrators. Other roles may remain open until qualified candidates are ready.                                                                        | Roles may remain open       |
| **3**   | Confirm repository access for all current maintainers and configure GitHub so changes, commits, pull requests, reviews, tests, and merges form a linked, traceable development record, including the second-review rule.          | To configure                |
| **4**   | Choose one SRS, use-case, and BDD template and document the standard connection from persona and user story through use case, scenario, issue, and implementation.                                                                | Template not yet selected   |
| **5**   | Review and refine the existing user stories and personas in the sparcd-requirements wiki, then identify the highest-priority stories.                                                                                             | Pending review              |
| **6**   | Convert selected stories into use cases, BDD/SRS requirements, and linked implementation issues in sparcd-exploration.                                                                                                            | Pending                     |
| **7**   | Define the normal discussion and approval process, the limited low-risk situations in which lazy consensus may be used, the required notification and review period, and the decisions that require explicit agreement or a vote. | Pending governance decision |
| **8**   | Document the minimal modular architecture for Uploader, Tagger, Explorer, and Home so development can proceed in parallel.                                                                                                        | Pending                     |
| **9**   | Configure automated tests and required checks before merge, and document shared guidance for AI-assisted development.                                                                                                             | Pending                     |
| **10**  | Complete governance, contributing, code of conduct, security, licensing, and onboarding documentation needed for Open Source Collective readiness.                                                                                | Pending                     |
| **11**  | Continue weekly meetings to remove blockers, make global project decisions, and review work through requirements, issues, and pull requests.                                                                                      | Ongoing                     |

[^1]: Templates consulted: Exosphere [Governance](https://exosphere.app/docs/governance/) and [Contribution Review Policy](https://exosphere.app/docs/review-policy/); ZeroMQ [Collective Code Construction Contract (C4)](https://rfc.zeromq.org/spec/42/). These are source templates, not SPARCd governance documents.
