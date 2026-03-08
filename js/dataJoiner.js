/**
 * Data Joiner Module
 * Handles relational joins between tables and normalization.
 */

export const DataJoiner = {
    /**
     * Process and join all raw tables into a master district object
     */
    processData(tables) {
        // Step 1: Normalize numbers for all numeric fields
        const normalizedTables = this.normalize(tables);

        // Map tables for easier access
        const { states, districts, party_results, election_operations, centers } = normalizedTables;

        // Create lookups — trim keys to handle whitespace in CSV
        const statesLookup = states.reduce((acc, s) => { acc[String(s.state_code).trim()] = s; return acc; }, {});

        // Build partiesLookup from party_results (unique party_code entries)
        // Ensure every party has a globally unique color if none is provided
        const generateDistinctColor = (index) => {
            const palette = [
                '#2563eb', '#16a34a', '#dc2626', '#eab308', '#9333ea',
                '#0d9488', '#ea580c', '#db2777', '#059669', '#4f46e5',
                '#ca8a04', '#b91c1c', '#1d4ed8', '#4d7c0f', '#a21caf'
            ];
            if (index < palette.length) return palette[index];
            // Algorithmic distinct hue fallback using golden ratio
            const h = (index * 137.508) % 360;
            return `hsl(${h}, 70%, 45%)`;
        };

        let colorIdx = 0;

        // The list of party codes that have official images in the local directory
        const partiesWithLogos = ['2', '7', '9', '12', '15', '17', '23', '27', '28', '29', '33', '35', '37', '38', '45', '48', '53', '55'];

        const partiesLookup = {};
        party_results.forEach(pr => {
            const code = String(pr.party_code).trim();
            if (!partiesLookup[code]) {
                const hasLogo = partiesWithLogos.includes(code);
                partiesLookup[code] = {
                    party_code: code,
                    party_name: (pr.party_name || code).trim(),
                    party_color: pr.party_color || generateDistinctColor(colorIdx++),
                    party_logo_url: pr.party_logo_url || (hasLogo ? `data/party logos/${code}.png` : '')
                };
            }
        });

        // Swap colors for party 15 and 37
        if (partiesLookup['15'] && partiesLookup['37']) {
            const tempColor = partiesLookup['15'].party_color;
            partiesLookup['15'].party_color = partiesLookup['37'].party_color;
            partiesLookup['37'].party_color = tempColor;
        }

        // Build District Objects
        const districtMaster = districts.map(district => {
            const districtCode = district.dist_code || district.district_code;
            // Ensure the code is consistently accessible under one property
            district.district_code = districtCode;

            // Join State
            district.state = statesLookup[district.state_code] || { state_name: 'Unknown' };

            // Join Operations (includes staff fields)
            district.operations = election_operations.find(op => (op.dist_code || op.district_code) === districtCode) || {};
            // Staff fields are now in the same operations row
            district.staff = district.operations;

            // Join Party Results (filtered by dist_code)
            district.party_results = party_results
                .filter(pr => (pr.dist_code || pr.district_code) === districtCode)
                .map(pr => {
                    const pc = String(pr.party_code).trim();
                    const party = partiesLookup[pc] || {};
                    // Use party_name from party_results row if party table has no entry
                    return {
                        ...pr,
                        party_code: pc,
                        party_name: party.party_name || pr.party_name || pc,
                        party_color: party.party_color,
                        party_logo_url: party.party_logo_url || ''
                    };
                });

            // Join Centers
            district.centers = centers.filter(c => (c.dist_code || c.district_code) === districtCode);

            // Determine Winning Party for this district (by seats_won or votes_received as fallback)
            district.winner = this.getWinningParty(district.party_results);

            // Calculate ID Collected Percentage (relative to registered)
            const regCount = Number(district.registered_people || 0);
            const idHolders = Number(district.id_cards_collected || 0);
            district.id_collected_perc = regCount > 0
                ? (idHolders / regCount) * 100
                : 0;

            // Calculate Turnout Percentage (Based on ID Cards Collected per request)
            const actualTurnout = Number(district.valid_votes || 0) + Number(district.invalid_votes || 0);
            district.turnout_perc = idHolders > 0
                ? (actualTurnout / idHolders) * 100
                : 0;
            
            // Calculate Invalid Votes Percentage (relative to total votes)
            district.invalid_perc = actualTurnout > 0
                ? (Number(district.invalid_votes || 0) / actualTurnout) * 100
                : 0;

            return district;
        });

        // ── Calculate Ranks for Map Modes ──
        const sortByMode = (arr, selector) => [...arr].sort((a, b) => selector(b) - selector(a));

        const turnoutR = sortByMode(districtMaster, d => d.turnout_perc || 0);
        const registeredR = sortByMode(districtMaster, d => d.registered_people || 0);
        const validR = sortByMode(districtMaster, d => d.valid_votes || 0);
        const invalidR = sortByMode(districtMaster, d => d.invalid_votes || 0);
        const seatsR = sortByMode(districtMaster, d => d.total_seats || 0);
        const densityR = sortByMode(districtMaster, d => d.operations?.polling_stations_used || 0);
        districtMaster.forEach(d => {
            d.ranks = {
                turnout: turnoutR.indexOf(d) + 1,
                registered: registeredR.indexOf(d) + 1,
                votes: validR.indexOf(d) + 1,
                invalid: invalidR.indexOf(d) + 1,
                seats: seatsR.indexOf(d) + 1,
                density: densityR.indexOf(d) + 1
            };
        });

        // ── Calculate Category Totals (for shares) ──
        const catTotals = {};
        districtMaster.forEach(d => {
            const cat = d.district_category || 'Unknown';
            if (!catTotals[cat]) catTotals[cat] = { seats: 0, votes: 0 };
            catTotals[cat].seats += (d.total_seats || 0);
            catTotals[cat].votes += (d.valid_votes || 0);
        });
        districtMaster.forEach(d => {
            d.category_totals = catTotals[d.district_category || 'Unknown'];
        });

        // Compute Global Totals
        const summary = this.computeGlobalTotals(districtMaster, partiesLookup, normalizedTables);

        console.log(`[DataJoiner] Total States in Sheet: ${normalizedTables.states?.length || 0}`);
        console.log(`[DataJoiner] Total Districts in results: ${districtMaster.length}`);

        return { districtMaster, summary, parties: partiesLookup };
    },

    /**
     * Convert a single district into a summary object for KPIs and charts
     */
    districtToSummary(district) {
        const partyVotes = {};
        const partySeats = {};
        const genderStats = { male: 0, female: 0 };
        const partyDetails = {};
        let totalCands = 0;
        let femaleCands = 0;
        let maleCands = 0;
        let contestedCount = 0;

        district.party_results.forEach(pr => {
            const pc = pr.party_code;
            partyVotes[pc] = pr.votes_received || 0;
            partySeats[pc] = pr.seats_won || 0;
            genderStats.male += pr.male_seats_won || 0;
            genderStats.female += pr.female_seats_won || 0;

            totalCands += (pr.cadidates_submited || 0);
            femaleCands += (pr.female_cadidates || 0);
            maleCands += (pr.male_cadidates || 0);

            const isContested = String(pr.is_contested).trim().toUpperCase() === 'TRUE';
            if (isContested) contestedCount++;

            partyDetails[pc] = {
                is_contested: pr.is_contested,
                candidates_submitted: pr.cadidates_submited || 0,
                male_candidates: pr.male_cadidates || 0,
                female_candidates: pr.female_cadidates || 0,
                male_seats_won: pr.male_seats_won || 0,
                female_seats_won: pr.female_seats_won || 0
            };
        });

        const ops = district.operations || {};
        const staff = district.staff || {};
        const turnoutVotes = (district.valid_votes || 0) + (district.invalid_votes || 0);

        return {
            totalStates: 1,
            totalDistricts: 1,
            candidates: {
                total: totalCands,
                female: femaleCands,
                femalePct: totalCands > 0 ? (femaleCands / totalCands) * 100 : 0,
                male: maleCands,
                malePct: totalCands > 0 ? (maleCands / totalCands) * 100 : 0
            },
            contestedPartiesCount: contestedCount,
            totalRegistered: district.registered_people || 0,
            totalIdCards: district.id_cards_collected || 0,
            idCollectedPct: district.registered_people > 0 ? (district.id_cards_collected / district.registered_people) * 100 : 0,
            turnoutVotes: turnoutVotes,
            turnoutPct: district.id_cards_collected > 0 ? (turnoutVotes / district.id_cards_collected) * 100 : 0,
            totalVotes: district.valid_votes || 0,
            validPct: turnoutVotes > 0 ? (district.valid_votes / turnoutVotes) * 100 : 0,
            totalInvalid: district.invalid_votes || 0,
            invalidPct: turnoutVotes > 0 ? (district.invalid_votes / turnoutVotes) * 100 : 0,
            pollingCentersCount: district.centers.filter(c => String(c.is_polling_center).trim().toUpperCase() === 'TRUE').length,
            totalPollingStations: ops.polling_stations_used || 0,

            totalSeats: district.total_seats || 0,
            overallWinner: district.winner || null,
            partyVotes,
            partySeats,
            partyDetails,
            genderStats: {
                male: maleCands,
                female: femaleCands,
                maleWinners: genderStats.male,
                femaleWinners: genderStats.female
            },
            opStats: {
                centers: ops.polling_centers_used || 0,
                stations: ops.polling_stations_used || 0,
                kits: ops.registration_kits_used || 0
            },
            staffStats: {
                reg: staff.registration_staff_used || 0,
                id: staff.id_distribution_staff_used || 0,
                day: staff.election_day_staff_used || 0
            }
        };
    },

    /**
     * Convert strings to numbers for known numeric fields
     */
    normalize(tables) {
        const numericFields = [
            'total_seats', 'total_cadidates', 'registered_people', 'id_cards_collected',
            'voters_turnout', 'valid_votes', 'invalid_votes', 'cadidates_submited',
            'male_cadidates', 'female_cadidates', 'votes_received', 'seats_won',
            'female_seats_won', 'male_seats_won', 'polling_stations_count',
            'registration_centers_used', 'registration_kits_used', 'polling_centers_used', 'polling_stations_used',
            'registration_staff_used', 'id_distribution_staff_used', 'election_day_staff_used',
            'latitude', 'longitude'
        ];

        // Deep copy and normalize headers + values
        const processed = {};
        Object.entries(tables).forEach(([key, table]) => {
            processed[key] = table.map(row => {
                const newRow = {};
                Object.keys(row).forEach(header => {
                    const cleanHeader = header.trim();
                    let val = row[header];
                    
                    if (numericFields.includes(cleanHeader)) {
                        if (typeof val === 'string') {
                            val = val.replace(/,/g, '').trim();
                        }
                        newRow[cleanHeader] = parseFloat(val) || 0;
                    } else {
                        newRow[cleanHeader] = typeof val === 'string' ? val.trim() : val;
                    }
                });
                return newRow;
            });
        });
        return processed;
    },

    /**
     * Compute winning party in a district
     */
    getWinningParty(partyResults) {
        if (!partyResults || partyResults.length === 0) return null;

        // Sort by seats_won descending, then votes_received as fallback
        return [...partyResults].sort((a, b) => {
            if (b.seats_won !== a.seats_won) return b.seats_won - a.seats_won;
            return b.votes_received - a.votes_received;
        })[0];
    },

    /**
     * Calculate global aggregates for summary cards
     */
    computeGlobalTotals(districtMaster, partiesLookup, fullTables) {
        let totalRegistered = 0;
        let totalIdCards = 0;
        let totalVotes = 0;
        let totalInvalid = 0;
        let totalSeats = 0;
        let totalCandidates = 0;
        let totalFemale = 0;
        let totalMale = 0;
        let totalFemaleWinners = 0;
        let totalMaleWinners = 0;
        let totalPollingStations = 0;

        const uniqueStates = new Set();
        const uniqueDistricts = new Set();
        const contestedPartiesSet = new Set();

        const partyVotes = {};
        const partySeats = {};
        const partyDetails = {}; // Track gendered seats globally

        districtMaster.forEach(d => {
            if (d.state_code) uniqueStates.add(d.state_code);
            if (d.district_code || d.dist_code) uniqueDistricts.add(d.district_code || d.dist_code);

            totalRegistered += (d.registered_people || 0);
            totalIdCards += (d.id_cards_collected || 0);
            totalVotes += (d.valid_votes || 0);
            totalInvalid += (d.invalid_votes || 0);
            totalSeats += (d.total_seats || 0);
            totalPollingStations += (d.operations.polling_stations_used || 0);

            d.party_results.forEach(pr => {
                const pc = pr.party_code;
                partyVotes[pc] = (partyVotes[pc] || 0) + (pr.votes_received || 0);
                partySeats[pc] = (partySeats[pc] || 0) + (pr.seats_won || 0);

                if (!partyDetails[pc]) {
                    partyDetails[pc] = { male_seats_won: 0, female_seats_won: 0 };
                }
                partyDetails[pc].male_seats_won += (pr.male_seats_won || 0);
                partyDetails[pc].female_seats_won += (pr.female_seats_won || 0);

                totalCandidates += (pr.cadidates_submited || 0);
                totalFemale += (pr.female_cadidates || 0);
                totalMale += (pr.male_cadidates || 0);
                totalFemaleWinners += (pr.female_seats_won || 0);
                totalMaleWinners += (pr.male_seats_won || 0);

                const isContested = String(pr.is_contested).trim().toUpperCase() === 'TRUE';
                if (isContested) contestedPartiesSet.add(pc);
            });
        });

        let pollingCentersCount = 0;
        districtMaster.forEach(d => {
            if (d.centers) {
                pollingCentersCount += d.centers.filter(c =>
                    String(c.is_polling_center).trim().toUpperCase() === 'TRUE'
                ).length;
            }
        });

        const turnoutVotes = totalVotes + totalInvalid;
        const idCollectedPct = totalRegistered > 0 ? (totalIdCards / totalRegistered) * 100 : 0;
        const turnoutPct = totalIdCards > 0 ? (turnoutVotes / totalIdCards) * 100 : 0;

        // Determine Overall Winner
        const overallWinnerCode = Object.keys(partySeats).sort((a, b) => {
            if (partySeats[b] !== partySeats[a]) return partySeats[b] - partySeats[a];
            return partyVotes[b] - partyVotes[a];
        })[0];

        const overallWinner = overallWinnerCode ? {
            ...partiesLookup[overallWinnerCode],
            seats_won: partySeats[overallWinnerCode],
            votes_received: partyVotes[overallWinnerCode]
        } : null;

        // Prioritize the actual states table for the count (dynamic from Google Sheets)
        let totalStatesCount = uniqueStates.size;
        if (fullTables && fullTables.states && Array.isArray(fullTables.states) && fullTables.states.length > 0) {
            totalStatesCount = fullTables.states.length;
        }

        return {
            totalStates: totalStatesCount,
            totalDistricts: uniqueDistricts.size,

            candidates: {
                total: totalCandidates,
                female: totalFemale,
                femalePct: totalCandidates > 0 ? (totalFemale / totalCandidates) * 100 : 0,
                male: totalMale,
                malePct: totalCandidates > 0 ? (totalMale / totalCandidates) * 100 : 0
            },

            contestedPartiesCount: contestedPartiesSet.size,
            totalRegistered,
            totalIdCards,
            idCollectedPct,
            turnoutVotes,
            turnoutPct,
            totalVotes,
            validPct: turnoutVotes > 0 ? (totalVotes / turnoutVotes) * 100 : 0,
            totalInvalid,
            invalidPct: turnoutVotes > 0 ? (totalInvalid / turnoutVotes) * 100 : 0,
            pollingCentersCount,
            totalPollingStations,

            totalSeats,
            overallWinner,
            genderStats: {
                male: totalMale,
                female: totalFemale,
                maleWinners: totalMaleWinners,
                femaleWinners: totalFemaleWinners
            },
            opStats: { centers: pollingCentersCount, stations: totalPollingStations },
            staffStats: { reg: 0, id: 0, day: 0 },
            overallTurnout: turnoutPct,
            partyVotes,
            partySeats,
            partyDetails
        };
    },

    /**
     * Attach processed district data to GeoJSON features
     */
    attachToGeoJSON(geoJSON, districtMaster) {
        if (!geoJSON || !geoJSON.features) return geoJSON;

        const districtLookup = districtMaster.reduce((acc, d) => {
            acc[d.dist_code || d.district_code] = d;
            return acc;
        }, {});

        geoJSON.features.forEach(feature => {
            const districtCode = String(feature.properties.dist_code || '').trim();
            feature.properties.data = districtLookup[districtCode] || null;

            // Helpful metadata for choropleth styling
            if (feature.properties.data) {
                const d = feature.properties.data;
                feature.properties.turnout = d.turnout_perc;
                feature.properties.validVotes = d.valid_votes;
                feature.properties.seats = d.total_seats;
                feature.properties.winnerColor = d.winner ? d.winner.party_color : '#ccc';
                feature.properties.category = d.district_category;
            }
        });

        return geoJSON;
    }
};
