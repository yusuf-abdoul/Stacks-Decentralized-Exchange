;; title: mock-token
;; version:
;; summary:
;; description:

;; traits
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
;;

;; token definitions
(define-fungible-token mock-token)
;;

;; constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))


;; public functions
(define-public (transfer
		(amount uint)
		(sender principal)
		(recipient principal)
		(memo (optional (buff 34)))
	)
	(begin
		(asserts! (is-eq tx-sender sender) err-not-token-owner)
		(try! (ft-transfer? mock-token amount sender recipient))
		(match memo to-print (print to-print) 0x)
		(ok true)
	)
)
(define-public (mint
		(amount uint)
		(recipient principal)
	)
	(begin
		(asserts! (is-eq tx-sender contract-owner) err-owner-only)
		(ft-mint? mock-token amount recipient)
	)
)
;;

;; read only functions
(define-read-only (get-name)
	(ok "Mock Token")
)

(define-read-only (get-symbol)
	(ok "MT")
)

(define-read-only (get-decimals)
	(ok u6)
)

(define-read-only (get-balance (who principal))
	(ok (ft-get-balance mock-token who))
)

(define-read-only (get-total-supply)
	(ok (ft-get-supply mock-token))
)

(define-read-only (get-token-uri)
	(ok none)
)

