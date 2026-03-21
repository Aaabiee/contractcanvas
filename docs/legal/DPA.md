# Data Processing Agreement (DPA)

**Between:** [CUSTOMER_NAME] ("Data Controller") and ContractCanvas ("Data Processor")

**Effective Date:** [DATE]

## 1. Scope

This DPA applies to the processing of personal data by ContractCanvas on behalf of the Data Controller in connection with the ContractCanvas platform services.

## 2. Definitions

- **Personal Data**: any information relating to an identified or identifiable natural person
- **Processing**: any operation performed on personal data (collection, storage, retrieval, erasure, etc.)
- **Sub-processor**: a third party engaged by ContractCanvas to process personal data

## 3. Processing Details

| Attribute | Detail |
|-----------|--------|
| Subject matter | Contract lifecycle management platform services |
| Duration | Term of the service agreement |
| Nature | Storage, retrieval, display, and transmission of legal documents and user data |
| Purpose | Providing CLM platform features as described in the Terms of Service |
| Categories of data subjects | Controller's employees, clients, and contract counterparties |
| Categories of personal data | Names, email addresses, IP addresses, document content, signature data |

## 4. Processor Obligations

ContractCanvas shall:

- Process personal data only on documented instructions from the Controller
- Ensure authorized personnel are bound by confidentiality obligations
- Implement appropriate technical and organizational security measures (see Section 6)
- Assist the Controller in responding to data subject requests (access, erasure, portability)
- Notify the Controller of personal data breaches within 72 hours
- Delete or return all personal data upon termination of the agreement
- Make available all information necessary to demonstrate compliance

## 5. Sub-Processors

Current sub-processors:

| Sub-processor | Purpose | Location |
|---------------|---------|----------|
| Amazon Web Services | Infrastructure, document storage | Configurable |
| Stripe | Payment processing | USA |
| DocuSign | Electronic signatures | USA |
| HelloSign | Electronic signatures | USA |
| Postmark | Email delivery | USA |
| Sentry | Error monitoring | USA |

ContractCanvas will notify the Controller at least 30 days before engaging a new sub-processor. The Controller may object in writing within 14 days.

## 6. Security Measures

- Encryption in transit: TLS 1.2+ on all connections
- Encryption at rest: AES-256 for stored documents (S3 server-side encryption)
- Access control: role-based, organization-scoped, JWT with 15-minute TTL
- Password security: bcrypt hashing with cost factor 12
- Audit logging: immutable records of all data access and modifications
- Backup: daily encrypted backups with 30-day retention
- Vulnerability management: dependency scanning, OWASP Top 10 mitigations

## 7. Data Breach Notification

In the event of a personal data breach, ContractCanvas will:

1. Notify the Controller within 72 hours of becoming aware
2. Provide details of the breach: nature, categories of data, approximate number of records
3. Describe measures taken or proposed to mitigate the breach
4. Cooperate with the Controller's breach response procedures

## 8. International Transfers

Where personal data is transferred outside the EEA, ContractCanvas ensures adequate safeguards through:

- Standard Contractual Clauses (SCCs) with sub-processors
- Adequacy decisions where applicable
- Binding Corporate Rules where applicable

## 9. Audit Rights

The Controller may audit ContractCanvas's compliance with this DPA:

- Upon reasonable written notice (minimum 30 days)
- During business hours, no more than once per year
- At the Controller's expense
- ContractCanvas may provide SOC 2 Type II reports as an alternative

## 10. Term and Termination

This DPA remains in effect for the duration of the service agreement. Upon termination, ContractCanvas will delete all Controller personal data within 30 days, unless retention is required by law.

## Signatures

**Data Controller:**
Name: ________________________
Title: ________________________
Date: ________________________

**Data Processor (ContractCanvas):**
Name: ________________________
Title: ________________________
Date: ________________________
