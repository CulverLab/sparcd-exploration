# SPARCd Meeting Summary

**November 12, 2026**

The team reviewed a proposed redesign of SPARCd’s data organization and permissions, along with plans for testing the Uploader and Tagger. Julian P and Julián G will refine the proposal and develop a proof of concept. Site codes, location confidentiality, data quality, and reporting needs remain central requirements; the architecture is still under development.

## Key discussion points

- **Data organization:** Replace the current 57 collections with a flatter structure organized around projects, areas, and sites. Tags would capture information such as land manager and mountain range, reducing duplication and supporting more flexible reporting. The team also explored separating media from settings and simplifying the storage hierarchy.
- **Site identity and uploads:** Simplify uploads by linking SD cards to camera deployments and reducing repeated manual selections. Susan emphasized that established site codes and accurate location data must remain available for monitoring and agency reports. How the proposed deployment workflow would fit WCC’s field methods needs further clarification.
- **Permissions and confidentiality:** Separate uploading and tagging access and provide more selective sharing, potentially through image-specific links. Liz and Susan emphasized control over sensitive locations and which information becomes public. Broader participation and crowdsourced tagging remain possibilities to evaluate.
- **Data quality and image processing:** Discussed duplicate detection using image hashes, verification of trusted contributors, and possible automated animal detection or filtering before human tagging. Human oversight would still be needed. Survey123 currently supports camera verification, and the team discussed limiting location information visible to taggers.
- **Testing and rollout:** Begin with a small group of selected users with varied usability needs. Julian estimated that the Uploader could be ready for beta testing in approximately one to one and a half weeks. Tagger readiness depends on migration from the University of Arizona server to Jetstream at Indiana University. These were tentative timelines, with a phased rollout discussed for the following two weeks.
- **Technical troubleshooting:** Susan and Julian P updated the sandbox DNS record to a CNAME. Other DNS configuration needs and missing files in the mapping application were identified for follow-up. Turning off video helped address Zoom audio problems.

## Action items

- **Julian P:** Work with Julián G on a second iteration of the architecture presentation and a proof-of-concept prototype. Test the upload process from a new volunteer’s perspective using his own trail-camera photos.
- **Julián G:** Discuss the storage design with Claudio, including alternatives to using locations as storage keys and the possibility of per-person directories. Review Liz’s closed GitHub issues and ask Chris why they were closed.
- **Liz:** Review outstanding usability concerns with Jane on Monday and share the GitHub issue list with Julian P and Julián G.
- **Susan:** Review the architecture proposal with Liz and provide feedback on reporting, site codes, confidentiality, and the field workflow.
- **Team:** Meet again the following week to review usability concerns, the revised architecture, and testing readiness.

## Links shared in the chat

- **SPARCd Explorer preview — Julián González:** https://juli4ng.github.io/sparcd-explorer-preview/explorer-next/
- **Camtrap DP example — Julian Pistorius:** https://camtrap-dp.tdwg.org/example/00a2c20d/
- **Camtrap DP data — Julian Pistorius:** https://camtrap-dp.tdwg.org/data/
